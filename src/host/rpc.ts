/**
 * RPC dispatcher for dsh-idea-git.
 *
 * One method table shared by the panel. Repository resolution and error shaping
 * happen through `withRepo`, so every git method has the same failure contract.
 */
import * as svc from './git/service.js'
import { clearConsole, readConsole } from './git/exec.js'

type Reply = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details?: unknown } }

function ok(value: unknown): Reply {
  return { ok: true, value }
}

function fail(error: any): Reply {
  const code = typeof error?.code === 'string' ? error.code : error instanceof svc.RepoError ? error.code : 'idea-git/failed'
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: { code, message, details: error?.details ?? {} } }
}

async function withRepo(ctx: any, payload: any, signal: AbortSignal | undefined, handler: (info: svc.RepoInfo) => Promise<unknown>): Promise<Reply> {
  const info = await svc.resolveRepo(ctx, payload)
  return ok(await handler(info))
}

export async function dispatch(ctx: any, method: string, payload: any, signal?: AbortSignal): Promise<Reply> {
  try {
    switch (method) {
      case 'addIgnore':
        return withRepo(ctx, payload, signal, (info) => svc.addIgnore(info, payload, signal))

      case 'cherryPick':
        return withRepo(ctx, payload, signal, (info) => svc.cherryPick(info, payload, signal))

      case 'tagCreate':
        return withRepo(ctx, payload, signal, (info) => svc.tagCreate(info, payload, signal))

      case 'renameBranch':
        return withRepo(ctx, payload, signal, (info) => svc.renameBranch(info, payload, signal))

      case 'reset':
        return withRepo(ctx, payload, signal, (info) => svc.resetCommit(info, payload, signal))

      case 'revert':
        return withRepo(ctx, payload, signal, (info) => svc.revertCommit(info, payload, signal))

      case 'lfsInfo':
        return ok(await svc.lfsInfo(ctx))

      case 'gitVersion':
        return ok(await svc.gitVersionInfo(ctx))

      case 'ping':
        return ok({ pong: true, at: Date.now() })

      case 'info':
        return ok(await svc.repoInfo(ctx, payload, signal))

      case 'status':
        return withRepo(ctx, payload, signal, (info) => svc.readStatus(info, signal))

      case 'log':
        return withRepo(ctx, payload, signal, (info) => svc.readLog(info, payload, signal))

      case 'commitFiles':
        return withRepo(ctx, payload, signal, (info) => svc.readCommitFiles(info, String(payload?.commit ?? ''), signal))

      case 'branches':
        return withRepo(ctx, payload, signal, (info) => svc.readBranches(info, signal))

      case 'tags':
        return withRepo(ctx, payload, signal, (info) => svc.readTags(info, signal))

      case 'remotes':
        return withRepo(ctx, payload, signal, (info) => svc.readRemotes(info, signal))

      case 'diffText':
        return withRepo(ctx, payload, signal, (info) => svc.diffText(info, payload, signal))

      case 'fileDiff':
        return withRepo(ctx, payload, signal, (info) => svc.fileDiffText(info, payload, signal))

      case 'commitDiff':
        return withRepo(ctx, payload, signal, (info) => svc.commitDiffText(info, payload, signal))

      case 'stashList':
        return withRepo(ctx, payload, signal, (info) => svc.readStashes(info, signal))

      case 'stashPush':
        return withRepo(ctx, payload, signal, (info) => svc.stashPush(info, payload, signal))

      case 'stashApply':
        return withRepo(ctx, payload, signal, (info) => svc.stashApply(info, payload, signal))

      case 'stashDrop':
        return withRepo(ctx, payload, signal, (info) => svc.stashDrop(info, payload, signal))

      case 'resolveConflict':
        return withRepo(ctx, payload, signal, (info) => svc.resolveConflict(info, payload, signal))

      case 'worktreeList':
        return withRepo(ctx, payload, signal, (info) => svc.readWorktrees(info, signal))

      case 'worktreeAdd':
        return withRepo(ctx, payload, signal, (info) => svc.addWorktree(info, payload, signal))

      case 'worktreeRemove':
        return withRepo(ctx, payload, signal, (info) => svc.removeWorktree(info, payload, signal))

      case 'blame':
        return withRepo(ctx, payload, signal, (info) => svc.readBlame(info, payload, signal))

      case 'aiCommit': {
        const info = await svc.resolveRepo(ctx, payload)
        const { generateCommitMessage } = await import('./git/ai.js')
        return ok(await generateCommitMessage(ctx, info, payload, signal))
      }

      case 'stage':
        return withRepo(ctx, payload, signal, (info) => svc.stage(info, payload?.paths, signal))

      case 'unstage':
        return withRepo(ctx, payload, signal, (info) => svc.unstage(info, payload?.paths, signal))

      case 'discard':
        return withRepo(ctx, payload, signal, (info) => svc.discard(info, payload, signal))

      case 'commit':
        return withRepo(ctx, payload, signal, (info) => svc.commit(info, payload, signal))

      case 'checkout':
        return withRepo(ctx, payload, signal, (info) => svc.checkout(info, payload, signal))

      case 'createBranch':
        return withRepo(ctx, payload, signal, (info) => svc.createBranch(info, payload, signal))

      case 'deleteBranch':
        return withRepo(ctx, payload, signal, (info) => svc.deleteBranch(info, payload, signal))

      case 'merge':
        return withRepo(ctx, payload, signal, (info) => svc.merge(info, payload, signal))

      case 'remote':
        return withRepo(ctx, payload, signal, (info) => svc.remoteOp(info, payload, signal))

      case 'console':
        return ok({ entries: readConsole() })

      case 'clearConsole':
        clearConsole()
        return ok({ ok: true })

      default:
        return { ok: false, error: { code: 'idea-git/unknown-method', message: `未知方法：${method}` } }
    }
  } catch (error) {
    return fail(error)
  }
}
