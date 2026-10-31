/**
 * Panel state store. A tiny external store (no zustand dependency) shared by the
 * button, the panel shell and the views.
 */
import * as api from './api'
import type { BlameLine, BranchItem, CommitItem, ConsoleEntry, FileEntry, RemoteItem, RepoInfoResult, StashItem, StatusResult, WorktreeItem } from './types'

export type TabId = 'changes' | 'log' | 'console' | 'stash' | 'shelf' | 'worktree' | 'submodule'

export interface Target {
  sessionId: string
  directory: string
}

export interface GitState {
  target: Target | null
  tab: TabId
  ready: boolean
  loading: boolean
  error: string | null
  errorCode: string | null
  info: RepoInfoResult | null
  files: FileEntry[]
  status: StatusResult | null
  branches: BranchItem[]
  tags: string[]
  remotes: RemoteItem[]
  commits: CommitItem[]
  logHasMore: boolean
  logLoading: boolean
  selectedCommit: string | null
  commitFiles: FileEntry[]
  message: string
  amend: boolean
  commitAuthor: string
  commitSignoff: boolean
  busy: boolean
  busyLabel: string | null
  consoleEntries: ConsoleEntry[]
  selection: string[]
  detailRange: { from: string; to: string } | null
  include: Record<string, boolean>
  stashes: StashItem[]
  shelves: Array<{ index: number; ref: string; name: string; date: number }>
  worktrees: WorktreeItem[]
  submodules: Array<{ path: string; sha: string; state: string; describe: string }>
  changelists: { lists: Array<{ id: string; name: string; comment: string }>; active: string; files: Record<string, string> } | null
  rebasePlan: { base: string | null; rows: Array<{ commit: string; short: string; summary: string; action: 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'; message: string }> } | null
  blame: { title: string; lines: BlameLine[]; loading: boolean } | null
  aiBusy: boolean
  logFilterFile: string | null
  logBranch: string | null
  logPath: string | null
  logHeadOnly: boolean
  logSort: 'date' | 'reverse' | 'topo'
  conflict: { file: string; loading: boolean; ours: string; theirs: string; base: string; working: string } | null
  toast: string | null
  compare: { title: string; from: string; to: string; loading: boolean; files: Array<{ path: string; kind: string }>; sel?: string; diff?: { loading: boolean; oldText: string; newText: string } } | null
  diff: { title: string; loading: boolean; file?: string; commit?: string; kind?: 'text' | 'image' | 'binary'; oldText?: string; newText?: string; oldB64?: string; newB64?: string; mime?: string; oldLabel?: string; newLabel?: string; lfs?: boolean } | null
  rev: number
}

function readTab(): TabId {
  try {
    const v = localStorage.getItem('dig.tab')
    if (v === 'changes' || v === 'log' || v === 'console' || v === 'stash' || v === 'worktree') return v
  } catch {}
  return 'changes'
}

const initial: GitState = {
  target: null,
  tab: readTab(),
  ready: false,
  loading: false,
  error: null,
  errorCode: null,
  info: null,
  files: [],
  status: null,
  branches: [],
  tags: [],
  remotes: [],
  commits: [],
  logHasMore: false,
  logLoading: false,
  selectedCommit: null,
  commitFiles: [],
  message: '',
  amend: false,
  commitAuthor: '',
  commitSignoff: false,
  busy: false,
  busyLabel: null,
  consoleEntries: [],
  selection: [],
  detailRange: null,
  include: {},
  conflict: null,
  toast: null,
  compare: null,
  stashes: [],
  shelves: [],
  worktrees: [],
  submodules: [],
  changelists: null,
  rebasePlan: null,
  blame: null,
  aiBusy: false,
  logFilterFile: null,
  logBranch: null,
  logPath: null,
  logHeadOnly: false,
  logSort: 'date',
  diff: null,
  rev: 0,
}

let state: GitState = initial
const subs = new Set<() => void>()

export function subscribe(fn: () => void): () => void {
  subs.add(fn)
  return () => subs.delete(fn)
}

export function getState(): GitState {
  return state
}

export function snapshotState(): GitState {
  return state
}

export function restoreState(snap: GitState | null | undefined) {
  if (snap) set(snap)
}

function set(patch: Partial<GitState>) {
  state = { ...state, ...patch, rev: state.rev + 1 }
  subs.forEach((f) => {
    try { f() } catch {}
  })
}

export function setTab(tab: TabId) {
  try { localStorage.setItem('dig.tab', tab) } catch {}
  set({ tab })
  if (tab === 'console') void loadConsole()
  if (tab === 'log' && state.commits.length === 0) void loadLog(true)
  if (tab === 'stash') void loadStashes()
  if (tab === 'shelf') void loadShelves()
  if (tab === 'worktree') void loadWorktrees()
  if (tab === 'submodule') void loadSubmodules()
}

export function setMessage(message: string) {
  set({ message })
}

export function setAmend(amend: boolean) {
  set({ amend })
}
export function setCommitAuthor(author: string) { set({ commitAuthor: author }) }
export function setCommitSignoff(v: boolean) { set({ commitSignoff: v }) }

export function toggleSelect(path: string) {
  const has = state.selection.includes(path)
  set({ selection: has ? state.selection.filter((p) => p !== path) : [...state.selection, path] })
}

export function clearError() {
  set({ error: null, errorCode: null })
}

/* ------------------------------------------------------------------ */

const targetPayload = () => ({
  sessionId: state.target?.sessionId,
  directory: state.target?.directory,
})

export async function activate(target: Target) {
  set({ target, ready: false })
  await refreshAll()
}

export async function refreshAll() {
  if (!state.target) return
  set({ loading: true, error: null, errorCode: null })
  try {
    const info = await api.rpc<RepoInfoResult>('info', targetPayload())
    if (!info.isRepo) {
      set({ loading: false, ready: true, info, error: info.reason || '当前工作区不是 Git 仓库', errorCode: info.code || 'git/not-a-repository', files: [], commits: [], branches: [], status: null })
      return
    }
    set({ info, ready: true })
    await Promise.all([refreshStatus(), refreshBranches(), refreshTags(), refreshRemotes()])
    await loadLog(true)
  } catch (e: any) {
    set({ loading: false, ready: true, error: e?.message || String(e), errorCode: e?.code || null })
  }
}

export async function refreshSummary() {
  if (!state.target || !state.info?.isRepo) return
  if (state.busy) return
  try {
    const status = await api.rpc<StatusResult>('status', targetPayload())
    set({ status, files: status.files })
  } catch {}
}

export async function refreshStatus() {
  if (!state.target) return
  try {
    const status = await api.rpc<StatusResult>('status', targetPayload())
    const include: Record<string, boolean> = {}
    for (const f of status.files) include[f.path] = state.include[f.path] !== false
    set({ status, files: status.files, include, error: null, errorCode: null })
  } catch (e: any) {
    set({ error: e?.message || String(e), errorCode: e?.code || null })
  }
}

async function refreshBranches() {
  try { set({ branches: await api.rpc<BranchItem[]>('branches', targetPayload()) }) } catch {}
}
async function refreshTags() {
  try { set({ tags: await api.rpc<string[]>('tags', targetPayload()) }) } catch {}
}
async function refreshRemotes() {
  try { set({ remotes: await api.rpc<RemoteItem[]>('remotes', targetPayload()) }) } catch {}
}

export async function loadLog(reset: boolean) {
  if (!state.target) return
  if (state.logLoading) return
  const skip = reset ? 0 : state.commits.length
  set({ logLoading: true })
  try {
    const r = await api.rpc<{ commits: CommitItem[]; hasMore: boolean }>('log', { ...targetPayload(), limit: 200, skip, ...(state.logFilterFile || state.logPath ? { file: state.logFilterFile || state.logPath } : {}), ...(state.logBranch ? { branch: state.logBranch } : {}), ...(state.logHeadOnly ? { headOnly: true } : {}), sort: state.logSort })
    set({ commits: reset ? r.commits : [...state.commits, ...r.commits], logHasMore: r.hasMore, logLoading: false })
  } catch (e: any) {
    set({ logLoading: false, error: e?.message || String(e), errorCode: e?.code || null })
  }
}

export async function selectCommit(id: string, mode: 'single' | 'toggle' | 'range' = 'single') {
  const order = state.commits.map((c) => c.id)
  let selection = state.selection
  if (mode === 'range' && state.selectedCommit) {
    const a = order.indexOf(state.selectedCommit)
    const b = order.indexOf(id)
    if (a >= 0 && b >= 0) {
      const [s, e] = a < b ? [a, b] : [b, a]
      selection = order.slice(s, e + 1)
    } else selection = [id]
  } else if (mode === 'toggle') {
    selection = selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]
  } else {
    selection = [id]
  }
  const multiRange = (() => {
    if (selection.length <= 1) return null
    const idxs = selection.map((sid) => order.indexOf(sid)).filter((i) => i >= 0).sort((a, b) => a - b)
    if (idxs.length < 2) return null
    const newest = state.commits[idxs[0]]
    const oldest = state.commits[idxs[idxs.length - 1]]
    if (!newest || !oldest) return null
    return { from: oldest.parents.length ? oldest.id + '^' : 'ROOT', to: newest.id }
  })()
  set({ selection, selectedCommit: id, commitFiles: [], detailRange: multiRange })
  try {
    const files = multiRange
      ? await api.rpc<Array<{ path: string; kind: string }>>('compareRefs', { ...targetPayload(), from: multiRange.from, to: multiRange.to }).then((fs) => fs.map((f) => ({ path: f.path, kind: f.kind as any, indexStatus: 'M', worktreeStatus: '.', staged: true, unstaged: false })))
      : await api.rpc<FileEntry[]>('commitFiles', { ...targetPayload(), commit: id })
    if (state.selectedCommit === id) set({ commitFiles: files })
  } catch {}
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

async function withBusy(label: string, fn: () => Promise<void>) {
  if (state.busy) return
  set({ busy: true, busyLabel: label })
  try {
    await fn()
  } catch (e: any) {
    const unknown = e?.code === 'idea-git/unknown-method' || /unknown-method|未知方法/.test(String(e?.message || ''))
    set({ error: (e?.message || String(e)) + (unknown ? '（Host 未加载最新代码，请完全退出并重新打开 DSH）' : ''), errorCode: e?.code || null })
  } finally {
    set({ busy: false, busyLabel: null })
  }
}

export function stage(paths: string[]) {
  return withBusy('Staging…', async () => {
    await api.rpc('stage', { ...targetPayload(), paths })
    await refreshStatus()
  })
}

export function unstage(paths: string[]) {
  return withBusy('Unstaging…', async () => {
    await api.rpc('unstage', { ...targetPayload(), paths })
    await refreshStatus()
  })
}

export function discard(paths: string[]) {
  return withBusy('Discarding…', async () => {
    await api.rpc('discard', { ...targetPayload(), paths, confirm: true })
    await refreshStatus()
  })
}

export function stageAll() {
  const paths = state.files.filter((f) => f.unstaged || !f.staged).map((f) => f.path)
  return stage(paths)
}

export function commitNow(push: boolean) {
  return withBusy(push ? 'Committing and pushing…' : 'Committing…', async () => {
    const checked = state.files.filter((f) => state.include[f.path] !== false).map((f) => f.path)
    if (!state.amend) {
      if (checked.length === 0) throw new Error('没有勾选要提交的文件')
      await api.rpc('stage', { ...targetPayload(), paths: checked })
    }
    await api.rpc('commit', { ...targetPayload(), message: state.message, amend: state.amend, signoff: state.commitSignoff, author: state.commitAuthor || undefined, paths: state.amend ? undefined : checked })
    try {
      const h: string[] = JSON.parse(localStorage.getItem('dig.msgHistory') || '[]')
      const msg = state.message.trim()
      if (msg && h[0] !== msg) { h.unshift(msg); localStorage.setItem('dig.msgHistory', JSON.stringify(h.slice(0, 20))) }
    } catch {}
    set({ message: '', amend: false, selectedCommit: null, commitFiles: [] })
    if (push) {
      try { await api.rpc('remote', { ...targetPayload(), op: 'push', setUpstream: true }) } catch {}
    }
    await refreshAll()
  })
}

export function checkout(branch: string, create = false) {
  return withBusy(create ? 'Creating and checking out…' : 'Checking out…', async () => {
    await api.rpc('checkout', { ...targetPayload(), branch, create })
    await refreshAll()
  })
}

export function remoteOp(op: 'fetch' | 'pull' | 'push') {
  return withBusy(op === 'fetch' ? 'Fetching…' : op === 'pull' ? 'Pulling…' : 'Pushing…', async () => {
    const r = await api.rpc<{ ok: boolean; output: string }>('remote', { ...targetPayload(), op })
    if (!r || !r.ok) throw new Error(r?.output || `${op} failed`)
    await refreshAll()
  })
}

export async function loadConsole() {
  try {
    const r = await api.rpc<{ entries: ConsoleEntry[] }>('console', targetPayload())
    set({ consoleEntries: r.entries })
  } catch {}
}

export async function clearConsole() {
  try { await api.rpc('clearConsole', targetPayload()); set({ consoleEntries: [] }) } catch {}
}

export function dismissError() {
  set({ error: null, errorCode: null })
}


/* ------------------------------------------------------------------ */
/* Diff viewer                                                         */
/* ------------------------------------------------------------------ */

export function closeDiff() {
  set({ diff: null, blame: null })
}

export async function openDiff(req: { title: string; path?: string; staged?: boolean; commit?: string }) {
  set({ diff: { title: req.title, loading: true, file: req.path, commit: req.commit }, blame: null })
  try {
    const r = await api.rpc<any>('fileDiff', { ...targetPayload(), file: req.path, staged: req.staged === true, commit: req.commit })
    set({ diff: { title: req.title, loading: false, file: req.path, commit: req.commit, kind: r.kind, oldText: r.oldText, newText: r.newText, oldB64: r.oldB64, newB64: r.newB64, mime: r.mime, oldLabel: r.oldLabel, newLabel: r.newLabel, lfs: r.lfs } })
  } catch (e: any) {
    set({ diff: { title: req.title, loading: false, file: req.path, commit: req.commit }, error: e?.message || String(e), errorCode: e?.code || null })
  }
}

/* ------------------------------------------------------------------ */
/* Stash                                                               */
/* ------------------------------------------------------------------ */

export async function loadStashes() {
  if (!state.target) return
  try {
    set({ stashes: await api.rpc<StashItem[]>('stashList', targetPayload()) })
  } catch {}
}

export function stashAll() {
  return withBusy('Staging…', async () => {
    await api.rpc('stashPush', { ...targetPayload(), includeUntracked: true })
    await refreshStatus()
    await loadStashes()
  })
}

export function stashApply(index: number, pop: boolean) {
  return withBusy(pop ? 'Pulling…' : 'Staging…', async () => {
    await api.rpc('stashApply', { ...targetPayload(), index, pop })
    await refreshAll()
  })
}

export function stashDrop(index: number) {
  return withBusy('Discarding…', async () => {
    await api.rpc('stashDrop', { ...targetPayload(), index })
    await loadStashes()
  })
}


/* ------------------------------------------------------------------ */
/* Blame                                                               */
/* ------------------------------------------------------------------ */

export function clearBlame() {
  set({ blame: null })
}

export async function openBlame(file: string, title: string) {
  set({ blame: { title, lines: [], loading: true } })
  try {
    const lines = await api.rpc<BlameLine[]>('blame', { ...targetPayload(), file })
    set({ blame: { title, lines, loading: false } })
  } catch (e: any) {
    set({ blame: { title, lines: [], loading: false }, error: e?.message || String(e), errorCode: e?.code || null })
  }
}

/* ------------------------------------------------------------------ */
/* Worktrees                                                           */
/* ------------------------------------------------------------------ */

export async function loadWorktrees() {
  if (!state.target) return
  try {
    set({ worktrees: await api.rpc<WorktreeItem[]>('worktreeList', targetPayload()) })
  } catch {}
}

export function addWorktree(worktreePath: string, newBranch?: string) {
  return withBusy('Staging…', async () => {
    await api.rpc('worktreeAdd', { ...targetPayload(), worktreePath, newBranch: newBranch || undefined })
    await loadWorktrees()
  })
}

export function removeWorktree(worktreePath: string) {
  return withBusy('Discarding…', async () => {
    await api.rpc('worktreeRemove', { ...targetPayload(), worktreePath, confirm: true })
    await loadWorktrees()
  })
}

/* ------------------------------------------------------------------ */
/* AI commit message                                                   */
/* ------------------------------------------------------------------ */

export function generateCommitMessage(locale: string) {
  if (state.aiBusy) return
  set({ aiBusy: true })
  void (async () => {
    try {
      const r = await api.rpc<{ message: string }>('aiCommit', { ...targetPayload(), locale })
      if (r.message) set({ message: r.message, aiBusy: false })
      else set({ aiBusy: false, error: 'No staged changes to describe', errorCode: null })
    } catch (e: any) {
      set({ aiBusy: false, error: e?.message || String(e), errorCode: e?.code || null })
    }
  })()
}


/* ------------------------------------------------------------------ */
/* File history                                                        */
/* ------------------------------------------------------------------ */

export function openHistory(file: string) {
  set({ tab: 'log', logFilterFile: file, commits: [], selectedCommit: null, commitFiles: [], diff: null, blame: null })
  void loadLog(true)
}

export function clearHistory() {
  set({ logFilterFile: null, commits: [], selectedCommit: null, commitFiles: [] })
  void loadLog(true)
}

export function resolveConflict(file: string, side: 'ours' | 'theirs' | 'mark') {
  return withBusy('Staging…', async () => {
    await api.rpc('resolveConflict', { ...targetPayload(), file, side: side === 'mark' ? undefined : side })
    await refreshStatus()
  })
}

/* ------------------------------------------------------------------ */
/* Branch / commit operations (context menus)                          */
/* ------------------------------------------------------------------ */

export function mergeBranch(name: string) {
  return withBusy('Merging…', async () => {
    const r = await api.rpc<{ ok: boolean; output: string }>('merge', { ...targetPayload(), branch: name })
    if (!r || !r.ok) {
      const out = (r?.output || '').trim()
      await refreshStatus()
      const conflicts = state.files.filter((f) => f.kind === 'conflicted')
      if (conflicts.length) {
        setTab('changes')
        setToast('合并有冲突：请在合并编辑器中解决后提交')
        void openConflict(conflicts[0].path)
        return
      }
      throw new Error(out || 'Merge failed (see Console)')
    }
    const out = (r.output || '').trim()
    if (/already up[ -]to[ -]date/i.test(out)) setToast(`已是最新：当前分支已包含 '${name}'`)
    else setToast(out || `Merged ${name}`)
    await refreshAll()
  })
}

export function deleteBranch(name: string, force = false) {
  return withBusy('Discarding…', async () => {
    await api.rpc('deleteBranch', { ...targetPayload(), name, force })
    await refreshAll()
  })
}

export function createBranchAt(name: string, start: string) {
  return withBusy('Creating branch…', async () => {
    await api.rpc('createBranch', { ...targetPayload(), name, start, checkout: true })
    await refreshAll()
  })
}

export function resetTo(commit: string, mode: 'soft' | 'mixed' | 'hard' = 'soft') {
  return withBusy('Resetting…', async () => {
    await api.rpc('reset', { ...targetPayload(), commit, mode, confirm: mode === 'hard' })
    await refreshAll()
  })
}

export function revertCommit(commit: string) {
  return withBusy('Reverting…', async () => {
    await api.rpc('revert', { ...targetPayload(), commit })
    await refreshAll()
  })
}


/* ------------------------------------------------------------------ */
/* More context-menu operations                                        */
/* ------------------------------------------------------------------ */

export function openBranchHistory(branch: string) {
  set({ tab: 'log', logBranch: branch, logFilterFile: null, commits: [], selectedCommit: null, commitFiles: [] })
  void loadLog(true)
}

export function clearBranchHistory() {
  set({ logBranch: null, commits: [], selectedCommit: null, commitFiles: [] })
  void loadLog(true)
}

export function cherryPick(commits: string[]) {
  return withBusy('Cherry-pick…', async () => {
    await api.rpc('cherryPick', { ...targetPayload(), commits })
    await refreshAll()
  })
}

export function createTag(name: string, commit: string, message?: string) {
  return withBusy('Tagging…', async () => {
    await api.rpc('tagCreate', { ...targetPayload(), name, commit, message })
    await refreshTags()
  })
}

export function renameBranch(from: string, to: string) {
  return withBusy('Renaming…', async () => {
    await api.rpc('renameBranch', { ...targetPayload(), from, to })
    await refreshAll()
  })
}


/* inclusion checkboxes */
export function toggleInclude(path: string) {
  set({ include: { ...state.include, [path]: state.include[path] === false } })
}
export function setIncludeAll(paths: string[], value: boolean) {
  const next = { ...state.include }
  for (const p of paths) next[p] = value
  set({ include: next })
}


export function addIgnore(files: string[], destination: 'gitignore' | 'exclude' = 'gitignore') {
  return withBusy('Updating ignore…', async () => {
    await api.rpc('addIgnore', { ...targetPayload(), files, destination })
    await refreshStatus()
  })
}


/* ------------------------------------------------------------------ */
/* Conflict resolution                                                 */
/* ------------------------------------------------------------------ */

export function closeConflict() {
  set({ conflict: null })
}

export async function openConflict(file: string) {
  set({ conflict: { file, loading: true, ours: '', theirs: '', base: '', working: '' }, diff: null, blame: null })
  try {
    const [r, w] = await Promise.all([
      api.rpc<{ ours: string; theirs: string; base: string }>('conflictVersions', { ...targetPayload(), file }),
      api.rpc<{ content: string }>('conflictWorking', { ...targetPayload(), file }),
    ])
    set({ conflict: { file, loading: false, ours: r.ours, theirs: r.theirs, base: r.base, working: w.content } })
  } catch (e: any) {
    set({ conflict: { file, loading: false, ours: '', theirs: '', base: '', working: '' }, error: e?.message || String(e), errorCode: e?.code || null })
  }
}

export function resolveConflictContent(file: string, content: string) {
  return withBusy('Resolving…', async () => {
    await api.rpc('resolveConflictContent', { ...targetPayload(), file, content })
    await refreshStatus()
    set({ conflict: null })
  })
}

export function resolveSide(file: string, side: 'ours' | 'theirs' | 'mark') {
  return withBusy('Resolving…', async () => {
    await api.rpc('resolveConflict', { ...targetPayload(), file, side: side === 'mark' ? undefined : side })
    await refreshStatus()
    set({ conflict: null })
  })
}


export function setPathFilter(path: string) {
  set({ tab: 'log', logPath: path, logFilterFile: null, commits: [], selectedCommit: null, commitFiles: [] })
  void loadLog(true)
}
export function clearPathFilter() {
  set({ logPath: null, commits: [], selectedCommit: null, commitFiles: [] })
  void loadLog(true)
}

export function amendMessage(commitId: string, message: string) {
  return withBusy('Amending…', async () => {
    if (state.commits[0]?.id !== commitId) throw new Error('只能修改最近一次提交的信息')
    await api.rpc('commit', { ...targetPayload(), message, amend: true })
    await refreshAll()
  })
}


export function revertCommits(commits: string[]) {
  return withBusy('Reverting…', async () => {
    await api.rpc('revertMany', { ...targetPayload(), commits })
    await refreshAll()
  })
}


/* ------------------------------------------------------------------ */
/* Compare / undo / browser                                            */
/* ------------------------------------------------------------------ */

export function closeCompare() {
  set({ compare: null })
}

export async function openCompare(from: string, to: string, title: string) {
  set({ compare: { title, from, to, loading: true, files: [] }, diff: null, blame: null, conflict: null })
  try {
    const files = await api.rpc<Array<{ path: string; kind: string }>>('compareRefs', { ...targetPayload(), from, to })
    set({ compare: { title, from, to, loading: false, files } })
    if (files.length) void selectCompareFile(files[0].path)
  } catch (e: any) {
    set({ compare: { title, from, to, loading: false, files: [] }, error: e?.message || String(e), errorCode: e?.code || null })
  }
}

export async function selectCompareFile(file: string) {
  const c = state.compare
  if (!c) return
  set({ compare: { ...c, sel: file, diff: { loading: true, oldText: '', newText: '' } } })
  try {
    const r = await api.rpc<{ oldText: string; newText: string }>('refDiff', { ...targetPayload(), from: c.from, to: c.to, file })
    if (state.compare) set({ compare: { ...state.compare, diff: { loading: false, oldText: r.oldText, newText: r.newText } } })
  } catch {
    if (state.compare) set({ compare: { ...state.compare, diff: { loading: false, oldText: '', newText: '' } } })
  }
}

export function undoLastCommit() {
  return withBusy('Undoing…', async () => {
    await api.rpc('undoCommit', { ...targetPayload(), commit: 'HEAD~1' })
    await refreshAll()
  })
}

export async function openCommitInBrowser(commit: string) {
  try {
    const { url } = await api.rpc<{ url: string | null }>('remoteUrl', targetPayload())
    if (!url) throw new Error('没有可用的远端地址')
    let base = url.replace(/\.git$/, '')
    let href = ''
    const m = /github\.com[:/](.+?)\/(.+)$/.exec(url)
    if (m) href = `https://github.com/${m[1]}/${m[2].replace(/\.git$/, '')}/commit/${commit}`
    else if (/gitlab/.test(url)) href = `${base}/-/commit/${commit}`
    else if (/bitbucket/.test(url)) href = `${base}/commits/${commit}`
    else href = `${base}/commit/${commit}`
    window.open(href, '_blank')
  } catch (e: any) {
    set({ error: e?.message || String(e), errorCode: null })
  }
}


export function setToast(message: string) {
  set({ toast: message })
  setTimeout(() => { if (state.toast === message) set({ toast: null }) }, 3500)
}

export function createPatch(target: { commit?: string; paths?: string[] }) {
  return withBusy('Creating patch…', async () => {
    const r = await api.rpc<{ path: string }>('createPatch', { ...targetPayload(), ...target })
    try { void navigator.clipboard?.writeText(r.path) } catch {}
    setToast('Patch saved: ' + r.path)
  })
}

export function openCompareWorking(from: string, title: string) {
  return openCompare(from, 'WORKTREE', title)
}


export function setLogHeadOnly(v: boolean) { set({ logHeadOnly: v, commits: [], selectedCommit: null, commitFiles: [] }); void loadLog(true) }
export function setLogSort(v: 'date' | 'reverse' | 'topo') { set({ logSort: v, commits: [], selectedCommit: null, commitFiles: [] }); void loadLog(true) }


export function squashHead() {
  return withBusy('Squashing…', async () => {
    await api.rpc('squashHead', { ...targetPayload() })
    await refreshAll()
  })
}

export function dropHead() {
  return withBusy('Dropping…', async () => {
    await api.rpc('dropHead', { ...targetPayload(), confirm: true })
    await refreshAll()
  })
}


export function rebaseBranch(onto: string) {
  return withBusy('Rebasing…', async () => {
    const r = await api.rpc<{ ok: boolean; output: string }>('rebase', { ...targetPayload(), onto })
    if (!r || !r.ok) throw new Error(r?.output || 'Rebase failed')
    await refreshAll()
  })
}

export function deleteTag(name: string) {
  return withBusy('Deleting tag…', async () => {
    await api.rpc('tagDelete', { ...targetPayload(), name })
    await refreshAll()
  })
}


export function addRemote(name: string, url: string) {
  return withBusy('Adding remote…', async () => { await api.rpc('remoteAdd', { ...targetPayload(), name, url }); await refreshAll() })
}
export function removeRemote(name: string) {
  return withBusy('Removing remote…', async () => { await api.rpc('remoteRemove', { ...targetPayload(), name }); await refreshAll() })
}
export function setRemoteUrl(name: string, url: string) {
  return withBusy('Updating remote…', async () => { await api.rpc('remoteSetUrl', { ...targetPayload(), name, url }); await refreshAll() })
}


export function lockWorktree(worktreePath: string, lock: boolean) {
  return withBusy(lock ? 'Locking…' : 'Unlocking…', async () => { await api.rpc('worktreeLock', { ...targetPayload(), worktreePath, lock }); await loadWorktrees() })
}
export function pruneWorktrees() {
  return withBusy('Pruning…', async () => { await api.rpc('worktreePrune', { ...targetPayload() }); await loadWorktrees() })
}


export async function openRangeDiff(from: string, to: string, file: string, title: string) {
  set({ diff: { title, loading: true, kind: 'text' }, blame: null, conflict: null })
  try {
    const r = await api.rpc<{ oldText: string; newText: string; oldLabel: string; newLabel: string }>('refDiff', { ...targetPayload(), from, to, file })
    set({ diff: { title, loading: false, kind: 'text', oldText: r.oldText, newText: r.newText, oldLabel: r.oldLabel, newLabel: r.newLabel } })
  } catch (e: any) {
    set({ diff: { title, loading: false, kind: 'text' }, error: e?.message || String(e) })
  }
}


export function applyPatchFromPath(path: string) {
  return withBusy('Applying patch…', async () => { await api.rpc('applyPatch', { ...targetPayload(), path }); await refreshAll() })
}
export function lfsTrack(pattern: string) {
  return withBusy('Updating LFS…', async () => { await api.rpc('lfsTrack', { ...targetPayload(), pattern }); await refreshStatus() })
}


export async function downloadCommitFile(commit: string, file: string) {
  return downloadCommitFiles(commit, [file])
}

export function downloadCommitFiles(commit: string, paths: string[]) {
  return withBusy('Saving…', async () => {
    const dir = await api.pickDirectory()
    if (!dir) return
    const r = await api.rpc<{ path: string }>('saveCommitFiles', { ...targetPayload(), commit, paths, dir })
    setToast('Saved to ' + r.path)
  })
}

export function cherryPickSelected(commit: string, paths: string[]) {
  return withBusy('Cherry-pick…', async () => { await api.rpc('cherryPickPaths', { ...targetPayload(), commit, paths }); await refreshAll() })
}


export function moveWorktree(from: string, to: string) {
  return withBusy('Moving worktree…', async () => { await api.rpc('worktreeMove', { ...targetPayload(), worktreePath: from, to }); await loadWorktrees() })
}
export function repairWorktree(paths: string[] = []) {
  return withBusy('Repairing worktrees…', async () => { await api.rpc('worktreeRepair', { ...targetPayload(), paths }); await loadWorktrees() })
}
export function pushTag(name: string) {
  return withBusy('Pushing tag…', async () => {
    const r = await api.rpc<{ ok: boolean; output: string }>('tagPush', { ...targetPayload(), name })
    if (!r || !r.ok) throw new Error(r?.output || 'push tag failed')
  })
}
export function pullInto(remote: string, branch: string, rebase: boolean) {
  return withBusy('Pulling…', async () => {
    const r = await api.rpc<{ ok: boolean; output: string }>('pullInto', { ...targetPayload(), remote, branch, rebase })
    if (!r || !r.ok) throw new Error(r?.output || 'pull failed')
    await refreshAll()
  })
}
export function checkoutAndRebase(branch: string, onto: string) {
  return withBusy('Checkout & Rebase…', async () => {
    await api.rpc('checkout', { ...targetPayload(), branch, create: false })
    const r = await api.rpc<{ ok: boolean; output: string }>('rebase', { ...targetPayload(), onto })
    if (!r || !r.ok) throw new Error(r?.output || 'rebase failed')
    await refreshAll()
  })
}


export function squashRange(ids: string[]) {
  return withBusy('Squashing…', async () => {
    await api.rpc('squashRange', { ...targetPayload(), ids })
    await refreshAll()
  })
}
export function dropCommit(commit: string) {
  return withBusy('Dropping…', async () => {
    const r = await api.rpc<{ ok: boolean; output: string }>('dropCommit', { ...targetPayload(), commit })
    if (!r || !r.ok) throw new Error(r?.output || 'drop failed')
    await refreshAll()
  })
}
export async function silentFetch() {
  try { await api.rpc('remote', { ...targetPayload(), op: 'fetch' }) } catch {}
}


/* Submodules / LFS locks */
export async function loadSubmodules() {
  if (!state.target) return
  try { set({ submodules: await api.rpc<Array<{ path: string; sha: string; state: string; describe: string }>>('submoduleStatus', targetPayload()) }) } catch {}
}
export function updateSubmodule(path?: string) {
  return withBusy('Updating submodules…', async () => { await api.rpc('submoduleUpdate', { ...targetPayload(), path }); await loadSubmodules() })
}
export function lfsLock(path: string) {
  return withBusy('Locking…', async () => { await api.rpc('lfsLock', { ...targetPayload(), path }); setToast('Locked: ' + path) })
}
export function lfsUnlock(path: string) {
  return withBusy('Unlocking…', async () => { await api.rpc('lfsUnlock', { ...targetPayload(), path }); setToast('Unlocked: ' + path) })
}


export function lfsMigrate(include: string) {
  return withBusy('Migrating to LFS…', async () => {
    const r = await api.rpc<{ ok: boolean; output: string }>('lfsMigrate', { ...targetPayload(), include })
    if (!r || !r.ok) throw new Error(r?.output || 'lfs migrate failed')
    await refreshAll()
  })
}


export async function loadShelves() {
  if (!state.target) return
  try { set({ shelves: await api.rpc<Array<{ index: number; ref: string; name: string; date: number }>>('shelfList', targetPayload()) }) } catch {}
}
export function shelfSave(name: string) {
  return withBusy('Shelving…', async () => { await api.rpc('shelfSave', { ...targetPayload(), name }); await refreshStatus(); await loadShelves() })
}
export function shelfApply(index: number, pop: boolean) {
  return withBusy(pop ? 'Popping…' : 'Applying…', async () => { await api.rpc('stashApply', { ...targetPayload(), index, pop }); await refreshAll() })
}
export function shelfDrop(index: number) {
  return withBusy('Dropping…', async () => { await api.rpc('stashDrop', { ...targetPayload(), index }); await loadShelves() })
}


export function editCommitMessage(commit: string, message: string) {
  return withBusy('Editing commit…', async () => {
    const r = await api.rpc<{ ok: boolean; output: string }>('editCommitMessage', { ...targetPayload(), commit, message })
    if (r && r.ok === false) throw new Error((r as any).output || 'edit failed')
    await refreshAll()
  })
}
export function fixupCommit(subject: string) {
  return prepareFixup('fixup', subject)
}
export function squashInto(subject: string) {
  return prepareFixup('squash', subject)
}
function prepareFixup(kind: 'fixup' | 'squash', subject: string) {
  return withBusy(kind === 'fixup' ? 'Fixup…' : 'Squash into…', async () => {
    await api.rpc('prepareFixup', { ...targetPayload(), message: `${kind}! ${subject}` })
    await refreshAll()
  })
}


/* Changelists */
export async function loadChangelists() {
  if (!state.target) return
  try { set({ changelists: await api.rpc('changelistsLoad', targetPayload()) }) } catch {}
}
async function saveChangelists(next: { lists: Array<{ id: string; name: string; comment: string }>; active: string; files: Record<string, string> }) {
  set({ changelists: next })
  try { const saved = await api.rpc<any>('changelistsSave', { ...targetPayload(), state: next }); set({ changelists: saved }) } catch (e: any) { set({ error: e?.message || String(e), errorCode: e?.code || null }) }
}
function currentCL() { return state.changelists || { lists: [{ id: 'default', name: 'Changes', comment: '' }], active: 'default', files: {} } }
export function newChangelist(name: string) {
  const cur = currentCL(); const id = 'cl-' + Date.now().toString(36)
  void saveChangelists({ lists: [...cur.lists, { id, name, comment: '' }], active: cur.active, files: cur.files })
}
export function renameChangelist(id: string, name: string) {
  const cur = currentCL(); void saveChangelists({ ...cur, lists: cur.lists.map((l) => (l.id === id ? { ...l, name } : l)) })
}
export function deleteChangelist(id: string) {
  const cur = currentCL(); if (id === 'default') return
  const files: Record<string, string> = {}
  for (const [k, v] of Object.entries(cur.files)) if (v !== id) files[k] = v
  void saveChangelists({ lists: cur.lists.filter((l) => l.id !== id), active: cur.active === id ? (cur.lists.find((l) => l.id !== id)?.id || 'default') : cur.active, files })
}
export function setActiveChangelist(id: string) {
  const cur = currentCL(); void saveChangelists({ ...cur, active: id })
}
export function moveToChangelist(paths: string[], id: string) {
  const cur = currentCL(); const files = { ...cur.files }
  for (const p of paths) { if (id === 'default') delete files[p]; else files[p] = id }
  void saveChangelists({ ...cur, files })
}


/* Interactive rebase plan (port of OpenIDEA rebasePlan) */
export function openRebasePlan(commitId: string) {
  const cs = state.commits
  const idx = cs.findIndex((c) => c.id === commitId)
  if (idx < 0) return
  const target = cs[idx]
  const rows = cs.slice(0, idx + 1).reverse().map((c) => ({ commit: c.id, short: c.shortId, summary: c.subject, action: 'pick' as const, message: c.subject }))
  set({ rebasePlan: { base: target.parents[0] ?? null, rows } })
}
export function setRebaseRow(i: number, patch: Partial<{ action: 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'; message: string }>) {
  const p = state.rebasePlan; if (!p) return
  const rows = p.rows.map((r, k) => (k === i ? { ...r, ...patch } : r))
  set({ rebasePlan: { ...p, rows } })
}
export function closeRebasePlan() { set({ rebasePlan: null }) }
export function runRebasePlan() {
  const p = state.rebasePlan; if (!p) return
  return withBusy('Rebasing…', async () => {
    const entries = p.rows.map((r) => ({ commit: r.commit, action: r.action, message: r.action === 'reword' ? r.message : undefined }))
    const r = await api.rpc<{ ok: boolean; output: string }>('interactiveRebase', { ...targetPayload(), base: p.base, entries })
    if (!r || !r.ok) throw new Error(r?.output || 'rebase failed')
    set({ rebasePlan: null })
    await refreshAll()
  })
}


export function saveWorktreeFile(file: string, content: string, stage: boolean) {
  return withBusy('Saving…', async () => {
    await api.rpc('saveWorktreeFile', { ...targetPayload(), file, content, stage })
    await refreshStatus()
    set({ diff: null })
  })
}


export function commitChangelist(paths: string[], push: boolean) {
  const inc: Record<string, boolean> = {}
  for (const f of state.files) inc[f.path] = paths.includes(f.path)
  set({ include: inc })
  return commitNow(push)
}
