/**
 * Repository service for dsh-idea-git.
 *
 * One function resolves "which repository" (explicit root → the named session's
 * workspace directory → Host inference), and `git rev-parse --show-toplevel`
 * turns any directory — including a subdirectory the workspace happens to open —
 * into the repository root. That is the whole point of the subdirectory support:
 * the panel always operates on the repository, not on the opened leaf folder.
 */
import path from 'node:path'
import fs from 'node:fs'
import { clearGitPathCache, gitOrThrow, resolveGitPath, runGit, runGitBytes } from './exec.js'

export interface RepoInfo {
  root: string
  gitPath: string
  bare: boolean
  worktree: boolean
}

export class RepoError extends Error {
  code: string
  details?: unknown
  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'RepoError'
    this.code = code
    this.details = details
  }
}

export interface FileEntry {
  path: string
  origPath?: string
  indexStatus: string
  worktreeStatus: string
  staged: boolean
  unstaged: boolean
  kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted' | 'ignored' | 'typechange'
}

export interface StatusResult {
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  detached: boolean
  files: FileEntry[]
}

export interface CommitItem {
  id: string
  shortId: string
  author: string
  authorEmail: string
  authorDate: number
  committerDate: number
  parents: string[]
  refs: string[]
  subject: string
  message: string
}

export interface BranchItem {
  name: string
  ref: string
  head: string
  current: boolean
  remote: boolean
  upstream: string | null
  ahead: number
  behind: number
  author: string
  date: number
  subject: string
}

/* ------------------------------------------------------------------ */
/* Target directory resolution                                         */
/* ------------------------------------------------------------------ */

function usable(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function sessionCwd(ctx: any, sessionId?: string): string | undefined {
  const named = usable(sessionId)
  if (named) {
    try {
      const session = ctx.get?.('sessions')?.get?.(named)
      const cwd = usable(session?.header?.cwd)
      if (cwd) return cwd
    } catch {}
    try {
      const ws = (ctx.get?.('workspaceRegistry')?.list?.() ?? []).find((w: any) => (w?.sessionIds ?? []).includes(named))
      const p = usable(ws?.path)
      if (p) return p
    } catch {}
  }
  try {
    const agents = ctx.get?.('agents')
    const initiator = agents?.currentInitiator?.()
    const cwd = usable(initiator?.session?.header?.cwd) ?? usable(initiator?.header?.cwd)
    if (cwd) return cwd
  } catch {}
  try {
    const ws = (ctx.get?.('workspaceRegistry')?.list?.() ?? []).find((w: any) => usable(w?.path))
    if (ws) return usable(ws.path)
  } catch {}
  try {
    return usable(ctx.get?.('workingDirectory')?.defaultDirectory)
  } catch {}
  return undefined
}

export function targetDirectory(ctx: any, payload: any): string | undefined {
  return usable(payload?.root) ?? usable(payload?.directory) ?? sessionCwd(ctx, payload?.sessionId)
}

/* ------------------------------------------------------------------ */
/* Repository detection                                                */
/* ------------------------------------------------------------------ */

export async function resolveRepo(ctx: any, payload: any): Promise<RepoInfo> {
  const configured = (() => {
    try { return usable(ctx.get?.('ideaGitConfig')?.gitPath) } catch { return undefined }
  })()
  const gitPath = await resolveGitPath(configured)
  if (!gitPath) throw new RepoError('git/not-found', 'Git was not found. Install Git or set its path in the plugin settings.')

  const dir = targetDirectory(ctx, payload)
  if (!dir) throw new RepoError('git/no-target', 'No workspace is open yet.')

  const top = await runGit(gitPath, { cwd: dir, args: ['rev-parse', '--show-toplevel'] })
  if (top.code !== 0) {
    throw new RepoError('git/not-a-repository', `Not a Git repository: ${dir}`, { dir })
  }
  const root = top.stdout.trim()
  if (!root) throw new RepoError('git/not-a-repository', `Not a Git repository: ${dir}`, { dir })

  const bareR = await runGit(gitPath, { cwd: root, args: ['rev-parse', '--is-bare-repository'] })
  const bare = bareR.code === 0 && bareR.stdout.trim() === 'true'

  let worktree = false
  try {
    const gitDir = await runGit(gitPath, { cwd: root, args: ['rev-parse', '--absolute-git-dir'] })
    const commonDir = await runGit(gitPath, { cwd: root, args: ['rev-parse', '--path-format=absolute', '--git-common-dir'] })
    if (gitDir.code === 0 && commonDir.code === 0) {
      worktree = path.resolve(gitDir.stdout.trim()) !== path.resolve(commonDir.stdout.trim())
    }
  } catch {}

  return { root, gitPath, bare, worktree }
}

export async function gitDirOf(info: RepoInfo): Promise<string | null> {
  const r = await runGit(info.gitPath, { cwd: info.root, args: ['rev-parse', '--absolute-git-dir'] })
  return r.code === 0 ? r.stdout.trim() : null
}

export async function currentOperation(info: RepoInfo): Promise<string | null> {
  const dir = await gitDirOf(info)
  if (!dir) return null
  const exists = (name: string) => fs.existsSync(path.join(dir, name))
  if (exists('MERGE_HEAD')) return 'merge'
  if (exists('rebase-merge') || exists('rebase-apply')) return 'rebase'
  if (exists('CHERRY_PICK_HEAD')) return 'cherry-pick'
  if (exists('REVERT_HEAD')) return 'revert'
  if (exists('BISECT_LOG')) return 'bisect'
  return null
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

function mapKind(x: string, y: string, unmerged: boolean): FileEntry['kind'] {
  if (unmerged) return 'conflicted'
  const s = x !== '.' ? x : y
  switch (s) {
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'T': return 'typechange'
    case '?': return 'untracked'
    case '!': return 'ignored'
    case 'M': default: return 'modified'
  }
}

export function parseStatusZ(stdout: string): StatusResult {
  const out: StatusResult = { head: null, upstream: null, ahead: 0, behind: 0, detached: false, files: [] }
  const tokens = stdout.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (!tok) continue
    if (tok.startsWith('# ')) {
      const line = tok.slice(2)
      if (line.startsWith('branch.head ')) {
        const v = line.slice('branch.head '.length)
        if (v === '(detached)') out.detached = true
        else out.head = v
      } else if (line.startsWith('branch.upstream ')) {
        out.upstream = line.slice('branch.upstream '.length)
      } else if (line.startsWith('branch.ab ')) {
        const m = /\+(\d+)\s+-(\d+)/.exec(line)
        if (m) { out.ahead = Number(m[1]); out.behind = Number(m[2]) }
      }
      continue
    }
    const type = tok[0]
    if (type === '1') {
      const f = tok.split(' ')
      const xy = f[1] ?? '..'
      const filePath = f.slice(8).join(' ')
      out.files.push(makeFile(filePath, undefined, xy[0] ?? '.', xy[1] ?? '.'))
    } else if (type === '2') {
      const f = tok.split(' ')
      const xy = f[1] ?? '..'
      const filePath = f.slice(9).join(' ')
      const orig = tokens[i + 1]
      if (orig !== undefined) i++
      out.files.push(makeFile(filePath, orig, xy[0] ?? '.', xy[1] ?? '.'))
    } else if (type === 'u') {
      const f = tok.split(' ')
      const filePath = f.slice(10).join(' ')
      out.files.push(makeFile(filePath, undefined, 'U', 'U', true))
    } else if (type === '?') {
      const filePath = tok.slice(2)
      out.files.push(makeFile(filePath, undefined, '?', '?', false, 'untracked'))
    } else if (type === '!') {
      const filePath = tok.slice(2)
      out.files.push(makeFile(filePath, undefined, '!', '!', false, 'ignored'))
    }
  }
  return out
}

function makeFile(filePath: string, origPath: string | undefined, x: string, y: string, unmerged = false, forcedKind?: FileEntry['kind']): FileEntry {
  const kind = forcedKind ?? mapKind(x, y, unmerged)
  return {
    path: filePath,
    ...(origPath ? { origPath } : {}),
    indexStatus: x,
    worktreeStatus: y,
    staged: !unmerged && x !== '.' && x !== '?' && x !== '!',
    unstaged: !unmerged && (y !== '.' || x === '?'),
    kind,
  }
}

export async function readStatus(info: RepoInfo, signal?: AbortSignal): Promise<StatusResult> {
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--find-renames'],
  })
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git status exited with code ${r.code}`)
  return parseStatusZ(r.stdout)
}

/* ------------------------------------------------------------------ */
/* Log                                                                 */
/* ------------------------------------------------------------------ */

const FIELD = '\x1f'
const RECORD = '\x1e'

export function parseLog(stdout: string): CommitItem[] {
  const commits: CommitItem[] = []
  for (const rec of stdout.split(RECORD)) {
    const text = rec.replace(/^\n+/, '')
    if (!text) continue
    const f = text.split(FIELD)
    if (f.length < 10) continue
    const refs = (f[7] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^HEAD -> /, ''))
    commits.push({
      id: f[0],
      shortId: f[1],
      author: f[2],
      authorEmail: f[3],
      authorDate: Number(f[4]) * 1000,
      committerDate: Number(f[5]) * 1000,
      parents: (f[6] || '').trim() ? f[6].trim().split(' ') : [],
      refs,
      subject: f[8],
      message: (f[9] || '').replace(/\n+$/, ''),
    })
  }
  return commits
}

export async function readLog(info: RepoInfo, payload: any, signal?: AbortSignal): Promise<{ commits: CommitItem[]; hasMore: boolean }> {
  const limit = Math.max(1, Math.min(1000, Number(payload?.limit) || 200))
  const skip = Math.max(0, Number(payload?.skip) || 0)
  const pretty = `%H${FIELD}%h${FIELD}%aN${FIELD}%aE${FIELD}%at${FIELD}%ct${FIELD}%P${FIELD}%D${FIELD}%s${FIELD}%B${RECORD}`
  const args = ['log', '--date-order', `--max-count=${limit + 1}`, `--skip=${skip}`, `--pretty=format:${pretty}`]
  if (usable(payload?.branch)) args.push(String(payload.branch))
  else if (payload?.nobranch !== true) args.push('--all')
  if (usable(payload?.file)) args.push('--', payload.file)
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args, timeoutMs: 60_000 })
  if (r.code !== 0) {
    const msg = (r.stderr || '') + (r.stdout || '')
    if (/does not have any commits|your current branch .* does not have any commits|bad default revision/i.test(msg)) {
      return { commits: [], hasMore: false }
    }
    throw new Error(r.stderr.trim() || `git log exited with code ${r.code}`)
  }
  const all = parseLog(r.stdout)
  const hasMore = all.length > limit
  return { commits: hasMore ? all.slice(0, limit) : all, hasMore }
}

export async function readCommitFiles(info: RepoInfo, commit: string, signal?: AbortSignal): Promise<FileEntry[]> {
  const args = ['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', '--root', commit]
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args })
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git diff-tree exited with code ${r.code}`)
  const files: FileEntry[] = []
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    const code = parts[0]
    const letter = code[0]
    const kind = letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : letter === 'R' ? 'renamed' : letter === 'C' ? 'copied' : 'modified'
    if (letter === 'R' || letter === 'C') {
      files.push({ path: parts[2] ?? parts[1], origPath: parts[1], indexStatus: letter, worktreeStatus: '.', staged: true, unstaged: false, kind })
    } else {
      files.push({ path: parts[1], indexStatus: letter, worktreeStatus: '.', staged: true, unstaged: false, kind })
    }
  }
  return files
}

/* ------------------------------------------------------------------ */
/* Branches / tags / remotes                                            */
/* ------------------------------------------------------------------ */

function parseTrack(track: string): { ahead: number; behind: number } {
  const m = /ahead (\d+)/.exec(track)
  const b = /behind (\d+)/.exec(track)
  return { ahead: m ? Number(m[1]) : 0, behind: b ? Number(b[1]) : 0 }
}

export async function readBranches(info: RepoInfo, signal?: AbortSignal): Promise<BranchItem[]> {
  const fmt = ['%(refname)', '%(refname:short)', '%(objectname)', '%(HEAD)', '%(upstream:short)', '%(upstream:track)', '%(authorname)', '%(committerdate:unix)', '%(subject)'].join(FIELD)
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args: ['for-each-ref', '--format=' + fmt, 'refs/heads', 'refs/remotes'] })
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git for-each-ref exited with code ${r.code}`)
  const out: BranchItem[] = []
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue
    const f = line.split(FIELD)
    const ref = f[0]
    if (ref.endsWith('/HEAD')) continue
    const { ahead, behind } = parseTrack(f[5] || '')
    out.push({
      name: f[1], ref, head: f[2], current: f[3] === '*', remote: ref.startsWith('refs/remotes/'),
      upstream: f[4] || null, ahead, behind, author: f[6], date: Number(f[7]) * 1000, subject: f[8],
    })
  }
  return out
}

export async function readTags(info: RepoInfo, signal?: AbortSignal): Promise<string[]> {
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args: ['tag', '--sort=-creatordate'] })
  if (r.code !== 0) return []
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
}

export async function readRemotes(info: RepoInfo, signal?: AbortSignal): Promise<Array<{ name: string; url: string }>> {
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args: ['remote', '-v'] })
  if (r.code !== 0) return []
  const map = new Map<string, string>()
  for (const line of r.stdout.split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)/.exec(line.trim())
    if (m && m[3] === 'fetch' && !map.has(m[1])) map.set(m[1], m[2])
  }
  return [...map].map(([name, url]) => ({ name, url }))
}

/* ------------------------------------------------------------------ */
/* Write operations                                                    */
/* ------------------------------------------------------------------ */

function assertSafePaths(info: RepoInfo, paths: unknown): string[] {
  if (!Array.isArray(paths) || paths.length === 0) throw new RepoError('git/no-paths', 'Missing file paths')
  const root = info.root
  return paths.map((p) => {
    if (typeof p !== 'string' || p === '') throw new RepoError('git/bad-path', 'Invalid path')
    const abs = path.resolve(root, p)
    const rel = path.relative(root, abs)
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new RepoError('git/outside-repo', `Path is outside the repository: ${p}`)
    return p
  })
}

async function runWrite(info: RepoInfo, args: string[], signal?: AbortSignal): Promise<string> {
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args, timeoutMs: 120_000 })
  if (r.code !== 0) throw new Error([r.stderr, r.stdout].find((s) => s && s.trim())?.trim() || `git ${args[0]} exited with code ${r.code}`)
  return r.stdout
}

export async function stage(info: RepoInfo, paths: unknown, signal?: AbortSignal) {
  const safe = assertSafePaths(info, paths)
  await runWrite(info, ['add', '--', ...safe], signal)
  return { ok: true }
}

export async function unstage(info: RepoInfo, paths: unknown, signal?: AbortSignal) {
  const safe = assertSafePaths(info, paths)
  try {
    await runWrite(info, ['restore', '--staged', '--', ...safe], signal)
  } catch {
    await runWrite(info, ['reset', 'HEAD', '--', ...safe], signal)
  }
  return { ok: true }
}

export async function discard(info: RepoInfo, payload: any, signal?: AbortSignal) {
  if (payload?.confirm !== true) throw new RepoError('git/needs-confirmation', 'Discarding changes needs confirmation')
  const safe = assertSafePaths(info, payload?.paths)
  const untracked: string[] = []
  const tracked: string[] = []
  for (const p of safe) {
    const ls = await runGit(info.gitPath, { cwd: info.root, args: ['ls-files', '--error-unmatch', '--', p] })
    if (ls.code === 0) tracked.push(p)
    else untracked.push(p)
  }
  if (tracked.length) await runWrite(info, ['restore', '--worktree', '--', ...tracked], signal)
  if (untracked.length) await runWrite(info, ['clean', '-f', '--', ...untracked], signal)
  return { ok: true }
}

export async function commit(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const message = typeof payload?.message === 'string' ? payload.message : ''
  if (!message.trim() && payload?.amend !== true) throw new RepoError('git/empty-message', 'Please enter a commit message')
  const args = ['commit', '-m', message]
  if (payload?.amend === true) args.push('--amend')
  if (payload?.signoff === true) args.push('--signoff')
  if (payload?.all === true) args.push('-a')
  if (payload?.amend !== true && Array.isArray(payload?.paths) && payload.paths.length) args.push('--', ...payload.paths.map(String))
  await runWrite(info, args, signal)
  const id = await runWrite(info, ['rev-parse', 'HEAD'], signal)
  return { id: id.trim() }
}

export async function checkout(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const branch = String(payload?.branch ?? '')
  if (!branch) throw new RepoError('git/bad-branch', 'Missing branch name')
  if (payload?.create === true) {
    const args = ['checkout', '-b', branch]
    if (payload?.start) args.push(String(payload.start))
    await runWrite(info, args, signal)
  } else {
    await runWrite(info, ['checkout', branch], signal)
  }
  return { ok: true }
}

export async function createBranch(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const name = String(payload?.name ?? '')
  if (!name) throw new RepoError('git/bad-branch', 'Missing branch name')
  const args = ['branch', name]
  if (payload?.start) args.push(String(payload.start))
  await runWrite(info, args, signal)
  if (payload?.checkout === true) await runWrite(info, ['checkout', name], signal)
  return { ok: true }
}

export async function deleteBranch(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const name = String(payload?.name ?? '')
  if (!name) throw new RepoError('git/bad-branch', 'Missing branch name')
  await runWrite(info, ['branch', payload?.force === true ? '-D' : '-d', name], signal)
  return { ok: true }
}

export async function merge(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const branch = String(payload?.branch ?? '')
  if (!branch) throw new RepoError('git/bad-branch', 'Missing branch name')
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args: ['merge', branch], timeoutMs: 120_000 })
  return { ok: r.code === 0, output: [r.stdout, r.stderr].filter(Boolean).join('\n'), code: r.code }
}

export async function remoteOp(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const op = String(payload?.op ?? 'fetch')
  const args = op === 'push'
    ? ['push', ...(payload?.setUpstream ? ['-u'] : []), ...(payload?.remote ? [String(payload.remote)] : []), ...(payload?.branch ? [String(payload.branch)] : [])]
    : op === 'pull'
      ? ['pull', '--ff-only']
      : ['fetch', '--all', '--prune']
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args, timeoutMs: 300_000 })
  return { ok: r.code === 0, output: [r.stdout, r.stderr].filter(Boolean).join('\n'), code: r.code }
}

export async function diffText(info: RepoInfo, payload: any, signal?: AbortSignal): Promise<string> {
  const args = ['diff', '--no-color']
  if (payload?.staged === true) args.push('--cached')
  if (payload?.file) args.push('--', String(payload.file))
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args, maxBuffer: 8 * 1024 * 1024 })
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git diff exited with code ${r.code}`)
  return r.stdout
}

function hasNul(t: string) { return t.indexOf('\u0000') >= 0 }

/** Both versions of one file, so the client can render split/unified and re-diff live. */
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'])
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' }

function isLfsPointer(buf: Buffer): boolean {
  return buf.length > 0 && buf.slice(0, 80).toString('utf8').startsWith('version https://git-lfs.github.com/spec/v1')
}

async function smudgeLfs(info: RepoInfo, buf: Buffer): Promise<Buffer> {
  if (!isLfsPointer(buf)) return buf
  try {
    const r = await runGitBytes(info.gitPath, { cwd: info.root, args: ['lfs', 'smudge'], input: buf, timeoutMs: 20000 })
    if (r.code === 0 && r.stdout.length) return r.stdout
  } catch {}
  return buf
}

/** Both versions of one file: text lines, or image bytes (base64) for image diffs, with LFS smudge. */
export async function fileDiffText(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const file = String(payload?.file ?? '').trim()
  if (!file) throw new RepoError('git/bad-path', 'Missing file path')
  const ext = path.extname(file).toLowerCase()
  const showBytes = async (revPath: string): Promise<Buffer> => {
    const r = await runGitBytes(info.gitPath, { cwd: info.root, args: ['show', revPath], signal })
    return r.code === 0 ? r.stdout : Buffer.alloc(0)
  }
  let oldBuf: Buffer
  let newBuf: Buffer
  let oldLabel = 'HEAD'
  let newLabel = 'Working Tree'
  let usedLfs = false
  if (payload?.commit) {
    const c = String(payload.commit)
    oldBuf = await showBytes(`${c}^:${file}`)
    newBuf = await showBytes(`${c}:${file}`)
    oldLabel = `${c.slice(0, 7)}^`
    newLabel = c.slice(0, 7)
  } else if (payload?.staged === true) {
    oldBuf = await showBytes(`HEAD:${file}`)
    newBuf = await showBytes(`:${file}`)
    oldLabel = 'HEAD'
    newLabel = 'Index'
  } else {
    oldBuf = await showBytes(`HEAD:${file}`)
    const abs = path.resolve(info.root, file)
    try { newBuf = fs.existsSync(abs) ? fs.readFileSync(abs) : Buffer.alloc(0) } catch { newBuf = Buffer.alloc(0) }
  }
  // LFS: smudge pointer blobs so images/contents show the real object.
  if (isLfsPointer(oldBuf)) { usedLfs = true; oldBuf = await smudgeLfs(info, oldBuf) }
  if (isLfsPointer(newBuf)) { usedLfs = true; newBuf = await smudgeLfs(info, newBuf) }
  const lfsInstalled = await hasLfs(info)

  if (IMAGE_EXT.has(ext)) {
    return {
      kind: 'image', mime: MIME[ext] || 'application/octet-stream',
      oldB64: oldBuf.length ? oldBuf.toString('base64') : '', newB64: newBuf.length ? newBuf.toString('base64') : '',
      oldLabel, newLabel, lfs: usedLfs, lfsInstalled,
    }
  }
  const binary = oldBuf.includes(0) || newBuf.includes(0)
  if (binary) return { kind: 'binary', oldLabel, newLabel, lfs: usedLfs, lfsInstalled }
  return { kind: 'text', oldText: oldBuf.toString('utf8'), newText: newBuf.toString('utf8'), oldLabel, newLabel, lfs: usedLfs, lfsInstalled }
}

let lfsCache: boolean | undefined
export async function hasLfs(info: RepoInfo): Promise<boolean> {
  if (lfsCache !== undefined) return lfsCache
  try {
    const r = await runGit(info.gitPath, { cwd: info.root, args: ['lfs', 'version'] })
    lfsCache = r.code === 0
  } catch { lfsCache = false }
  return lfsCache
}

export async function lfsInfo(ctx: any): Promise<{ installed: boolean; version?: string }> {
  const gitPath = await resolveGitPath()
  if (!gitPath) return { installed: false }
  const r = await runGit(gitPath, { cwd: process.cwd(), args: ['lfs', 'version'] })
  return { installed: r.code === 0, version: r.stdout.trim() || r.stderr.trim() }
}

export async function commitDiffText(info: RepoInfo, payload: any, signal?: AbortSignal): Promise<string> {
  const commit = String(payload?.commit ?? '')
  if (!commit) throw new RepoError('git/bad-commit', 'Missing commit')
  const args = ['show', '--format=', '--no-color', '-M', commit]
  if (payload?.file) args.push('--', String(payload.file))
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args, maxBuffer: 8 * 1024 * 1024 })
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git show exited with code ${r.code}`)
  return r.stdout
}

/* ------------------------------------------------------------------ */
/* Stash                                                               */
/* ------------------------------------------------------------------ */

export interface StashItem {
  index: number
  ref: string
  hash: string
  message: string
  date: number
  author: string
}

export async function readStashes(info: RepoInfo, signal?: AbortSignal): Promise<StashItem[]> {
  const fmt = ['%gd', '%H', '%gs', '%ct', '%aN'].join(FIELD)
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args: ['stash', 'list', '--format=' + fmt] })
  if (r.code !== 0) return []
  const out: StashItem[] = []
  let i = 0
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue
    const f = line.split(FIELD)
    out.push({ index: i++, ref: f[0], hash: f[1], message: f[2], date: Number(f[3]) * 1000, author: f[4] })
  }
  return out
}

export async function stashPush(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const args = ['stash', 'push']
  if (payload?.includeUntracked === true) args.push('-u')
  if (payload?.message) args.push('-m', String(payload.message))
  await runWrite(info, args, signal)
  return { ok: true }
}

export async function stashApply(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const index = Number(payload?.index ?? 0)
  const verb = payload?.pop === true ? 'pop' : 'apply'
  await runWrite(info, ['stash', verb, `stash@{${index}}`], signal)
  return { ok: true }
}

export async function stashDrop(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const index = Number(payload?.index ?? 0)
  await runWrite(info, ['stash', 'drop', `stash@{${index}}`], signal)
  return { ok: true }
}

export async function resolveConflict(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const file = String(payload?.file ?? '').trim()
  if (!file) throw new RepoError('git/bad-path', 'Missing file path')
  const side = payload?.side === 'theirs' ? '--theirs' : payload?.side === 'ours' ? '--ours' : null
  if (side) await runWrite(info, ['checkout', side, '--', file], signal)
  await runWrite(info, ['add', '--', file], signal)
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Worktrees                                                           */
/* ------------------------------------------------------------------ */

export interface WorktreeItem {
  path: string
  head: string
  branch: string | null
  bare: boolean
  locked: boolean
  prunable: boolean
  current: boolean
}

export async function readWorktrees(info: RepoInfo, signal?: AbortSignal): Promise<WorktreeItem[]> {
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args: ['worktree', 'list', '--porcelain'] })
  if (r.code !== 0) return []
  const items: WorktreeItem[] = []
  let cur: WorktreeItem | null = null
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) items.push(cur)
      cur = { path: line.slice('worktree '.length), head: '', branch: null, bare: false, locked: false, prunable: false, current: false }
    } else if (!cur) {
      continue
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice(5)
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (line === 'bare') {
      cur.bare = true
    } else if (line.startsWith('locked')) {
      cur.locked = true
    } else if (line.startsWith('prunable')) {
      cur.prunable = true
    }
  }
  if (cur) items.push(cur)
  const root = path.resolve(info.root)
  for (const it of items) it.current = path.resolve(it.path) === root
  return items
}

export async function addWorktree(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const target = String(payload?.worktreePath ?? payload?.target ?? '').trim()
  if (!target) throw new RepoError('git/bad-path', 'Missing worktree path')
  const args = ['worktree', 'add']
  if (payload?.newBranch) args.push('-b', String(payload.newBranch))
  args.push(target)
  args.push(String(payload?.commitish || 'HEAD'))
  await runWrite(info, args, signal)
  return { ok: true }
}

export async function removeWorktree(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const target = String(payload?.worktreePath ?? payload?.target ?? '').trim()
  if (!target) throw new RepoError('git/bad-path', 'Missing worktree path')
  if (payload?.confirm !== true) throw new RepoError('git/needs-confirmation', 'Removing a worktree needs confirmation')
  const args = ['worktree', 'remove']
  if (payload?.force === true) args.push('--force')
  args.push(target)
  await runWrite(info, args, signal)
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Blame                                                               */
/* ------------------------------------------------------------------ */

export interface BlameLine {
  line: number
  sha: string
  shortSha: string
  author: string
  time: number
  summary: string
  content: string
}

export async function readBlame(info: RepoInfo, payload: any, signal?: AbortSignal): Promise<BlameLine[]> {
  const filePath = String(payload?.file ?? '').trim()
  if (!filePath) throw new RepoError('git/bad-path', 'Missing file path')
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args: ['blame', '--line-porcelain', '--', filePath], maxBuffer: 16 * 1024 * 1024 })
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git blame exited with code ${r.code}`)
  const out: BlameLine[] = []
  let sha = ''
  let line = 0
  let author = ''
  let time = 0
  let summary = ''
  for (const ln of r.stdout.split('\n')) {
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(ln)
    if (header) {
      sha = header[1]
      line = Number(header[2])
      author = ''
      time = 0
      summary = ''
      continue
    }
    if (ln.startsWith('\t')) {
      out.push({ line, sha, shortSha: sha.slice(0, 7), author, time: time * 1000, summary, content: ln.slice(1) })
      continue
    }
    if (ln.startsWith('author ')) author = ln.slice(7)
    else if (ln.startsWith('author-time ')) time = Number(ln.slice(12)) || 0
    else if (ln.startsWith('summary ')) summary = ln.slice(8)
  }
  return out
}


/* ------------------------------------------------------------------ */
/* High level info                                                     */
/* ------------------------------------------------------------------ */

export async function repoInfo(ctx: any, payload: any, signal?: AbortSignal) {
  let info: RepoInfo
  try {
    info = await resolveRepo(ctx, payload)
  } catch (error) {
    if (error instanceof RepoError) {
      return { isRepo: false, code: error.code, reason: error.message, directory: targetDirectory(ctx, payload) ?? null }
    }
    throw error
  }
  let status: StatusResult | null = null
  try {
    status = await readStatus(info, signal)
  } catch {}
  const operation = await currentOperation(info)
  return {
    isRepo: true,
    root: info.root,
    bare: info.bare,
    worktree: info.worktree,
    branch: status
      ? { head: status.head, upstream: status.upstream, ahead: status.ahead, behind: status.behind, detached: status.detached }
      : null,
    operation,
  }
}


export async function resetCommit(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const commit = String(payload?.commit || 'HEAD')
  const mode = payload?.mode === 'mixed' ? 'mixed' : 'soft'
  await runWrite(info, ['reset', `--${mode}`, commit], signal)
  return { ok: true }
}

export async function revertCommit(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const commit = String(payload?.commit ?? '')
  if (!commit) throw new RepoError('git/bad-commit', 'Missing commit')
  await runWrite(info, ['revert', '--no-edit', commit], signal)
  return { ok: true }
}

export async function cherryPick(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const commits: string[] = Array.isArray(payload?.commits) ? payload.commits.map(String) : payload?.commit ? [String(payload.commit)] : []
  if (!commits.length) throw new RepoError('git/bad-commit', 'Missing commit')
  await runWrite(info, ['cherry-pick', ...commits], signal)
  return { ok: true }
}

export async function tagCreate(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const name = String(payload?.name ?? '').trim()
  if (!name) throw new RepoError('git/bad-tag', 'Missing tag name')
  const args = ['tag']
  if (payload?.message) args.push('-a', '-m', String(payload.message))
  args.push(name)
  if (payload?.commit) args.push(String(payload.commit))
  await runWrite(info, args, signal)
  return { ok: true }
}

export async function renameBranch(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const from = String(payload?.from ?? '').trim()
  const to = String(payload?.to ?? '').trim()
  if (!from || !to) throw new RepoError('git/bad-branch', 'Missing branch name')
  await runWrite(info, ['branch', '-m', from, to], signal)
  return { ok: true }
}

export async function addIgnore(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const files: string[] = Array.isArray(payload?.files) ? payload.files.map(String) : []
  if (!files.length) throw new RepoError('git/no-paths', 'Missing paths')
  const destination = payload?.destination === 'exclude' ? 'exclude' : 'gitignore'
  let target: string
  if (destination === 'gitignore') {
    target = path.join(info.root, '.gitignore')
  } else {
    const dir = await gitDirOf(info)
    if (!dir) throw new RepoError('git/not-a-repository', 'Not a repository')
    target = path.join(dir, 'info', 'exclude')
  }
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  const lines = new Set(existing.split('\n').map((l) => l.trim()))
  const added = files.filter((f) => !lines.has('/' + f) && !lines.has(f))
  if (added.length) {
    const prefix = existing && !existing.endsWith('\n') ? existing + '\n' : existing
    fs.writeFileSync(target, prefix + added.map((f) => '/' + f).join('\n') + '\n')
  }
  return { added }
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

export async function gitVersionInfo(ctx: any): Promise<{ found: boolean; path?: string; version?: string }> {
  const configured = (() => { try { return usable(ctx.get?.('ideaGitConfig')?.gitPath) } catch { return undefined } })()
  const gitPath = await resolveGitPath(configured)
  if (!gitPath) return { found: false }
  const r = await runGit(gitPath, { cwd: process.cwd(), args: ['--version'] })
  return { found: r.code === 0, path: gitPath, version: r.stdout.trim() || r.stderr.trim() }
}
