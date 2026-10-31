/** Client-side protocol types mirroring the Host RPC surface. */

export type FileKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflicted"
  | "ignored"
  | "typechange"

export interface FileEntry {
  path: string
  origPath?: string
  indexStatus: string
  worktreeStatus: string
  staged: boolean
  unstaged: boolean
  kind: FileKind
}

export interface BranchInfo {
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  detached: boolean
}

export interface StatusResult extends BranchInfo {
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

export interface RepoInfoResult {
  isRepo: boolean
  root?: string
  bare?: boolean
  worktree?: boolean
  branch?: BranchInfo | null
  operation?: string | null
  code?: string
  reason?: string
  directory?: string | null
}

export interface RemoteItem {
  name: string
  url: string
}

export interface ConsoleEntry {
  id: number
  at: number
  cwd: string
  command: string
  code: number
  durationMs: number
  stdout: string
  stderr: string
}

export interface StashItem {
  index: number
  ref: string
  hash: string
  message: string
  date: number
  author: string
}

export interface WorktreeItem {
  path: string
  head: string
  branch: string | null
  bare: boolean
  locked: boolean
  prunable: boolean
  current: boolean
}

export interface BlameLine {
  line: number
  sha: string
  shortSha: string
  author: string
  time: number
  summary: string
  content: string
}
