/**
 * AI commit-message generation over the Host `llm` service.
 *
 * - Language follows the DSH UI locale (zh → 中文, otherwise English).
 * - Only TEXT changes are sent: binary files, Git-LFS objects, build artifacts,
 *   lockfiles and very large files are summarized by name, not diffed.
 * - For many files the diff budget is spent on the smallest meaningful changes
 *   (sorted by change size) up to a file-count and character cap; the rest are
 *   listed so the model still knows they changed.
 */
import { runGit } from './exec.js'
import type { RepoInfo } from './service.js'

function selection(ctx: any, sessionId?: string): { provider?: string; model?: string } {
  const ok = (s: any) => (s && s.provider && s.model ? { provider: s.provider, model: s.model } : {})
  if (sessionId) {
    try {
      const session = ctx.get?.('sessions')?.get?.(sessionId)
      try {
        const proj = ctx.get?.('sessionProjections')?.stateOf?.(session, 'modelSelection')
        const got = ok(proj?.pending) || ok(proj?.current) || ok(proj?.value) || ok(proj)
        if (got.provider) return got
      } catch {}
      if (session) {
        try {
          const h = typeof session.requestHeader === 'function' ? session.requestHeader() : session.requestHeader
          const got = ok(h?.config) || ok(session?.header?.config)
          if (got.provider) return got
        } catch {}
      }
    } catch {}
  }
  try {
    const initiator = ctx.get?.('agents')?.currentInitiator?.()
    const s = initiator?.session ?? initiator
    const h = typeof s?.requestHeader === 'function' ? s.requestHeader() : s?.requestHeader
    const got = ok(h?.config)
    if (got.provider) return got
  } catch {}
  try {
    const got = ok(ctx.get?.('agentDefaultModel')?.currentSelection?.())
    if (got.provider) return got
  } catch {}
  return {}
}

const ARTIFACT = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.nuxt|vendor)\//i
const LOCKFILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock)$/i
const MINIFIED = /\.(min\.(js|css)|map|snap)$/i
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|pdf|zip|gz|tgz|bz2|xz|tar|jar|class|so|dylib|dll|exe|bin|o|a|woff2?|ttf|otf|eot|mp4|mov|mp3|wav|flac|psd|sketch)$/i
const BIG_FILE_LINES = 2000
const MAX_FILES = 30
const MAX_DIFF_CHARS = 12000

interface FileStat { path: string; adds: number | null; dels: number | null }

async function numstat(info: RepoInfo, staged: boolean, signal?: AbortSignal): Promise<FileStat[]> {
  const args = ['diff', '--numstat', '--no-color']
  if (staged) args.push('--cached')
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args })
  if (r.code !== 0) return []
  const out: FileStat[] = []
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (!m) continue
    out.push({ path: m[3], adds: m[1] === '-' ? null : Number(m[1]), dels: m[2] === '-' ? null : Number(m[2]) })
  }
  return out
}

async function lfsNames(info: RepoInfo, signal?: AbortSignal): Promise<Set<string>> {
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args: ['lfs', 'ls-files', '-n'] })
  if (r.code !== 0) return new Set()
  return new Set(r.stdout.split('\n').map((x) => x.trim()).filter(Boolean))
}

function classify(f: FileStat, lfs: Set<string>): 'text' | 'excluded' {
  if (f.adds === null || f.dels === null) return 'excluded'
  if (lfs.has(f.path)) return 'excluded'
  if (BINARY_EXT.test(f.path) || ARTIFACT.test(f.path) || LOCKFILES.test(f.path) || MINIFIED.test(f.path)) return 'excluded'
  if ((f.adds + f.dels) > BIG_FILE_LINES) return 'excluded'
  return 'text'
}

export async function generateCommitMessage(ctx: any, info: RepoInfo, payload: any, signal?: AbortSignal): Promise<{ message: string }> {
  const llm = ctx.get?.('llm') ?? ctx.llm
  if (!llm || typeof llm.stream !== 'function') throw new Error('No model service is available in the current profile.')
  const provided = payload?.provider && payload?.model ? { provider: payload.provider, model: payload.model } : null
  const sel = provided || selection(ctx, payload?.sessionId)
  if (!sel.provider || !sel.model) throw new Error('Cannot read the current session model; select a model in that session and retry.')

  let staged = true
  let files = await numstat(info, true, signal)
  if (!files.length) { staged = false; files = await numstat(info, false, signal) }
  if (!files.length) return { message: '' }

  const lfs = await lfsNames(info, signal)
  const texts = files.filter((f) => classify(f, lfs) === 'text')
  const excluded = files.filter((f) => classify(f, lfs) === 'excluded')

  const chosen = [...texts].sort((a, b) => (a.adds! + a.dels!) - (b.adds! + b.dels!)).slice(0, MAX_FILES)
  const chosenPaths = chosen.map((f) => f.path)
  let diff = ''
  if (chosenPaths.length) {
    const args = ['diff', '--no-color']
    if (staged) args.push('--cached')
    args.push('--', ...chosenPaths)
    const r = await runGit(info.gitPath, { cwd: info.root, signal, args, maxBuffer: 32 * 1024 * 1024 })
    diff = r.stdout
  }
  if (diff.length > MAX_DIFF_CHARS) diff = diff.slice(0, MAX_DIFF_CHARS) + '\n...(truncated)'

  const listLine = (f: FileStat) => `- ${f.path} (+${f.adds ?? 0} -${f.dels ?? 0})`
  const header = [
    `Changed files: ${files.length} total, ${texts.length} text, ${excluded.length} binary/LFS/large excluded.`,
    chosen.length ? `Diff included for:\n${chosen.map(listLine).join('\n')}` : '',
    texts.length > chosen.length ? `Other text files (name only): ${texts.filter((f) => !chosenPaths.includes(f.path)).map((f) => f.path).slice(0, 40).join(', ')}` : '',
    excluded.length ? `Excluded (binary / LFS / build / lock / very large): ${excluded.map((f) => f.path).slice(0, 40).join(', ')}` : '',
  ].filter(Boolean).join('\n')

  const zh = String(payload?.locale ?? '').toLowerCase().startsWith('zh')
  const system = zh
    ? '你是一名严谨的 Git 提交信息撰写助手。请完全使用简体中文输出。根据给定的文本差异，输出一条提交信息：第一行是不超过 72 个字符的摘要，必要时空一行再用要点描述细节。只输出提交信息本身，不要解释，不要 Markdown 代码围栏，不要编造差异中不存在的信息；二进制/大文件仅按文件名说明其被修改。'
    : 'You are a precise Git commit-message assistant. Write entirely in English. Given the text diff, output one commit message: a subject line of at most 72 characters, then optionally a blank line and bullet points. Output only the message — no explanation, no markdown fences, no invented facts; mention binary/large files by name only.'
  const user = header + '\n\n' + (zh ? '代码差异：\n\n' : 'Diff:\n\n') + (diff || '(no text diff available)')

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
      else if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') throw new Error(chunk.reason.failure?.message || 'AI generation failed')
    }
  } catch (error) {
    throw new Error('AI generation failed: ' + (error instanceof Error ? error.message : String(error)))
  }
  return { message: text.trim() }
}
