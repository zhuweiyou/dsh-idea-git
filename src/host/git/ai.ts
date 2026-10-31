/**
 * AI commit-message generation over the Host's `llm` service.
 *
 * The call is the plugin's own model call (never a conversation turn): it reads
 * the staged (or working-tree) diff and streams a commit message back. Provider
 * and model follow the session's current selection, then the default model.
 */
import { runGit } from './exec.js'
import type { RepoInfo } from './service.js'

function configOf(session: any): { provider?: string; model?: string } {
  if (!session) return {}
  const ok = (c: any) => (c && c.provider && c.model ? { provider: c.provider, model: c.model } : {})
  // requestHeader may be a method or a property depending on the Host generation.
  try {
    const h = typeof session.requestHeader === 'function' ? session.requestHeader() : session.requestHeader
    const got = ok(h?.config) || ok(h?.model) || ok(session.requestConfig)
    if (got.provider) return got
  } catch {}
  return ok(session.header?.config) || ok(session.config) || {}
}

function selection(ctx: any, sessionId?: string): { provider?: string; model?: string } {
  const ok = (s: any) => (s && s.provider && s.model ? { provider: s.provider, model: s.model } : {})
  if (sessionId) {
    try {
      const session = ctx.get?.('sessions')?.get?.(sessionId)
      // Pending choice in the session controller wins over the last request.
      try {
        const proj = ctx.get?.('sessionProjections')?.stateOf?.(session, 'modelSelection')
        const got = ok(proj?.pending) || ok(proj?.current) || ok(proj?.value) || ok(proj)
        if (got.provider) return got
      } catch {}
      const cfg = configOf(session)
      if (cfg.provider) return cfg
    } catch {}
  }
  try {
    const initiator = ctx.get?.('agents')?.currentInitiator?.()
    const cfg = configOf(initiator?.session ?? initiator)
    if (cfg.provider) return cfg
  } catch {}
  try {
    const sel = ctx.get?.('agentDefaultModel')?.currentSelection?.()
    if (ok(sel).provider) return ok(sel)
  } catch {}
  return {}
}

export async function generateCommitMessage(ctx: any, info: RepoInfo, payload: any, signal?: AbortSignal): Promise<{ message: string }> {
  const llm = ctx.get?.('llm') ?? ctx.llm
  if (!llm || typeof llm.stream !== 'function') throw new Error('当前 profile 没有可用的模型服务。')

  const provided = payload?.provider && payload?.model ? { provider: payload.provider, model: payload.model } : null
  const sel = provided || selection(ctx, payload?.sessionId)
  if (!sel.provider || !sel.model) throw new Error('无法读取当前会话的模型，请在该会话中选择模型后再试。')

  let diff = (await runGit(info.gitPath, { cwd: info.root, signal, args: ['diff', '--cached', '--no-color'] })).stdout
  if (!diff.trim()) diff = (await runGit(info.gitPath, { cwd: info.root, signal, args: ['diff', '--no-color'] })).stdout
  if (!diff.trim()) return { message: '' }
  const body = diff.length > 12000 ? diff.slice(0, 12000) + '\n...(truncated)' : diff

  const zh = String(payload?.locale ?? '').toLowerCase().startsWith('zh')
  const system = zh
    ? '你是一名严谨的 Git 提交信息撰写助手。根据给定的代码差异，输出一条提交信息：第一行是不超过 72 个字符的摘要，必要时空一行再用要点描述细节。只输出提交信息本身，不要解释，不要 Markdown 代码围栏，不要编造差异中不存在的信息。'
    : 'You are a precise Git commit-message assistant. Given the diff, output one commit message: a subject line of at most 72 characters, then optionally a blank line and bullet points. Output only the message — no explanation, no markdown fences, no invented facts.'
  const user = (zh ? '以下是即将提交的代码差异：\n\n' : 'Here is the staged diff:\n\n') + body

  let text = ''
  try {
    const options = {
      provider: sel.provider,
      model: sel.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
      maxTokens: 800,
      signal,
      ...(payload?.sessionId ? { sessionId: payload.sessionId } : {}),
    }
    for await (const chunk of llm.stream(options)) {
      if (chunk?.type === 'text-delta') text += chunk.text
      else if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') throw new Error(chunk.reason.failure?.message || 'AI 生成失败')
    }
  } catch (error) {
    throw new Error('AI 生成失败：' + (error instanceof Error ? error.message : String(error)))
  }
  return { message: text.trim() }
}
