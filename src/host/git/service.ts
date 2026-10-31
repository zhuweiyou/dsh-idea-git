/**
 * Repository service for dsh-idea-git.
 *
 * One function resolves "which repository" (explicit root → the named session's
 * workspace directory → Host inference), and `git rev-parse --show-toplevel`
 * turns any directory — including a subdirectory the workspace happens to open —
 * into the repository root. That is the whole point of the subdirectory support:
 * the panel always operates on the repository, not on the opened leaf folder.
 */
import path from "node:path"
import fs from "node:fs"
import { createHash } from "node:crypto"
import os from "node:os"
import { resolveGitPath, runGit, runGitBytes } from "./exec.js"
import { getSettings } from "../settings.js"
import { zipStore } from "./zip.js"

export interface RepoInfo {
  root: string
  gitPath: string
  bare: boolean
  worktree: boolean
}

function samePath(a: string, b: string): boolean {
  const ra = path.resolve(a)
  const rb = path.resolve(b)
  return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb
}

export class RepoError extends Error {
  code: string
  details?: unknown
  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = "RepoError"
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
  kind: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "conflicted" | "ignored" | "typechange"
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
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function sessionCwd(ctx: any, sessionId?: string): string | undefined {
  const named = usable(sessionId)
  if (named) {
    try {
      const session = ctx.get?.("sessions")?.get?.(named)
      const cwd = usable(session?.header?.cwd)
      if (cwd) return cwd
    } catch {}
    try {
      const ws = (ctx.get?.("workspaceRegistry")?.list?.() ?? []).find((w: any) =>
        (w?.sessionIds ?? []).includes(named),
      )
      const p = usable(ws?.path)
      if (p) return p
    } catch {}
  }
  try {
    const agents = ctx.get?.("agents")
    const initiator = agents?.currentInitiator?.()
    const cwd = usable(initiator?.session?.header?.cwd) ?? usable(initiator?.header?.cwd)
    if (cwd) return cwd
  } catch {}
  try {
    const ws = (ctx.get?.("workspaceRegistry")?.list?.() ?? []).find((w: any) => usable(w?.path))
    if (ws) return usable(ws.path)
  } catch {}
  try {
    return usable(ctx.get?.("workingDirectory")?.defaultDirectory)
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
  const configured = usable(getSettings().gitPath)
  const gitPath = await resolveGitPath(configured)
  if (!gitPath)
    throw new RepoError("git/not-found", "Git was not found. Install Git or set its path in the plugin settings.")

  const dir = targetDirectory(ctx, payload)
  if (!dir) throw new RepoError("git/no-target", "No workspace is open yet.")

  const top = await runGit(gitPath, { cwd: dir, args: ["rev-parse", "--show-toplevel"] })
  if (top.code !== 0) {
    throw new RepoError("git/not-a-repository", `Not a Git repository: ${dir}`, { dir })
  }
  const root = top.stdout.trim()
  if (!root) throw new RepoError("git/not-a-repository", `Not a Git repository: ${dir}`, { dir })

  const bareR = await runGit(gitPath, { cwd: root, args: ["rev-parse", "--is-bare-repository"] })
  const bare = bareR.code === 0 && bareR.stdout.trim() === "true"

  let worktree = false
  try {
    const gitDir = await runGit(gitPath, { cwd: root, args: ["rev-parse", "--absolute-git-dir"] })
    const commonDir = await runGit(gitPath, {
      cwd: root,
      args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    })
    if (gitDir.code === 0 && commonDir.code === 0) {
      worktree = !samePath(gitDir.stdout.trim(), commonDir.stdout.trim())
    }
  } catch {}

  return { root, gitPath, bare, worktree }
}

export async function gitDirOf(info: RepoInfo): Promise<string | null> {
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    args: ["rev-parse", "--absolute-git-dir"],
  })
  return r.code === 0 ? r.stdout.trim() : null
}

export async function currentOperation(info: RepoInfo): Promise<string | null> {
  const dir = await gitDirOf(info)
  if (!dir) return null
  const exists = (name: string) => fs.existsSync(path.join(dir, name))
  if (exists("MERGE_HEAD")) return "merge"
  if (exists("rebase-merge") || exists("rebase-apply")) return "rebase"
  if (exists("CHERRY_PICK_HEAD")) return "cherry-pick"
  if (exists("REVERT_HEAD")) return "revert"
  if (exists("BISECT_LOG")) return "bisect"
  return null
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

function mapKind(x: string, y: string, unmerged: boolean): FileEntry["kind"] {
  if (unmerged) return "conflicted"
  const s = x !== "." ? x : y
  switch (s) {
    case "A":
      return "added"
    case "D":
      return "deleted"
    case "R":
      return "renamed"
    case "C":
      return "copied"
    case "T":
      return "typechange"
    case "?":
      return "untracked"
    case "!":
      return "ignored"
    case "M":
    default:
      return "modified"
  }
}

export function parseStatusZ(stdout: string): StatusResult {
  const out: StatusResult = {
    head: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    files: [],
  }
  const tokens = stdout.split("\0")
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (!tok) continue
    if (tok.startsWith("# ")) {
      const line = tok.slice(2)
      if (line.startsWith("branch.head ")) {
        const v = line.slice("branch.head ".length)
        if (v === "(detached)") out.detached = true
        else out.head = v
      } else if (line.startsWith("branch.upstream ")) {
        out.upstream = line.slice("branch.upstream ".length)
      } else if (line.startsWith("branch.ab ")) {
        const m = /\+(\d+)\s+-(\d+)/.exec(line)
        if (m) {
          out.ahead = Number(m[1])
          out.behind = Number(m[2])
        }
      }
      continue
    }
    const type = tok[0]
    if (type === "1") {
      const f = tok.split(" ")
      const xy = f[1] ?? ".."
      const filePath = f.slice(8).join(" ")
      out.files.push(makeFile(filePath, undefined, xy[0] ?? ".", xy[1] ?? "."))
    } else if (type === "2") {
      const f = tok.split(" ")
      const xy = f[1] ?? ".."
      const filePath = f.slice(9).join(" ")
      const orig = tokens[i + 1]
      if (orig !== undefined) i++
      out.files.push(makeFile(filePath, orig, xy[0] ?? ".", xy[1] ?? "."))
    } else if (type === "u") {
      const f = tok.split(" ")
      const filePath = f.slice(10).join(" ")
      out.files.push(makeFile(filePath, undefined, "U", "U", true))
    } else if (type === "?") {
      const filePath = tok.slice(2)
      out.files.push(makeFile(filePath, undefined, "?", "?", false, "untracked"))
    } else if (type === "!") {
      const filePath = tok.slice(2)
      out.files.push(makeFile(filePath, undefined, "!", "!", false, "ignored"))
    }
  }
  return out
}

function makeFile(
  filePath: string,
  origPath: string | undefined,
  x: string,
  y: string,
  unmerged = false,
  forcedKind?: FileEntry["kind"],
): FileEntry {
  const kind = forcedKind ?? mapKind(x, y, unmerged)
  return {
    path: filePath,
    ...(origPath ? { origPath } : {}),
    indexStatus: x,
    worktreeStatus: y,
    staged: !unmerged && x !== "." && x !== "?" && x !== "!",
    unstaged: !unmerged && (y !== "." || x === "?"),
    kind,
  }
}

export async function readStatus(info: RepoInfo, signal?: AbortSignal): Promise<StatusResult> {
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all", "--find-renames"],
  })
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git status exited with code ${r.code}`)
  return parseStatusZ(r.stdout)
}

/* ------------------------------------------------------------------ */
/* Log                                                                 */
/* ------------------------------------------------------------------ */

const FIELD = "\x1f"
const RECORD = "\x1e"

export function parseLog(stdout: string): CommitItem[] {
  const commits: CommitItem[] = []
  for (const rec of stdout.split(RECORD)) {
    const text = rec.replace(/^\n+/, "")
    if (!text) continue
    const f = text.split(FIELD)
    if (f.length < 10) continue
    const refs = (f[7] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^HEAD -> /, ""))
    commits.push({
      id: f[0],
      shortId: f[1],
      author: f[2],
      authorEmail: f[3],
      authorDate: Number(f[4]) * 1000,
      committerDate: Number(f[5]) * 1000,
      parents: (f[6] || "").trim() ? f[6].trim().split(" ") : [],
      refs,
      subject: f[8],
      message: (f[9] || "").replace(/\n+$/, ""),
    })
  }
  return commits
}

export async function readLog(
  info: RepoInfo,
  payload: any,
  signal?: AbortSignal,
): Promise<{ commits: CommitItem[]; hasMore: boolean }> {
  const limit = Math.max(1, Math.min(1000, Number(payload?.limit) || 200))
  const skip = Math.max(0, Number(payload?.skip) || 0)
  const pretty = `%H${FIELD}%h${FIELD}%aN${FIELD}%aE${FIELD}%at${FIELD}%ct${FIELD}%P${FIELD}%D${FIELD}%s${FIELD}%B${RECORD}`
  const order = payload?.sort === "topo" ? "--topo-order" : "--date-order"
  const args = ["log", order]
  if (payload?.sort === "reverse") args.push("--reverse")
  if (payload?.firstParent === true) args.push("--first-parent")
  if (payload?.noMerges === true) args.push("--no-merges")
  args.push(`--max-count=${limit + 1}`, `--skip=${skip}`, `--pretty=format:${pretty}`)
  if (payload?.headOnly === true) args.push("HEAD")
  else if (usable(payload?.branch)) args.push(String(payload.branch))
  else if (payload?.nobranch !== true) args.push("--all")
  if (usable(payload?.file)) args.push("--", payload.file)
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args, timeoutMs: 60_000 })
  if (r.code !== 0) {
    const msg = (r.stderr || "") + (r.stdout || "")
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
  const args = ["diff-tree", "--no-commit-id", "--name-status", "-r", "-M", "--root", commit]
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args })
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git diff-tree exited with code ${r.code}`)
  const files: FileEntry[] = []
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue
    const parts = line.split("\t")
    const code = parts[0]
    const letter = code[0]
    const kind =
      letter === "A"
        ? "added"
        : letter === "D"
          ? "deleted"
          : letter === "R"
            ? "renamed"
            : letter === "C"
              ? "copied"
              : "modified"
    if (letter === "R" || letter === "C") {
      files.push({
        path: parts[2] ?? parts[1],
        origPath: parts[1],
        indexStatus: letter,
        worktreeStatus: ".",
        staged: true,
        unstaged: false,
        kind,
      })
    } else {
      files.push({
        path: parts[1],
        indexStatus: letter,
        worktreeStatus: ".",
        staged: true,
        unstaged: false,
        kind,
      })
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
  const fmt = [
    "%(refname)",
    "%(refname:short)",
    "%(objectname)",
    "%(HEAD)",
    "%(upstream:short)",
    "%(upstream:track)",
    "%(authorname)",
    "%(committerdate:unix)",
    "%(subject)",
  ].join(FIELD)
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["for-each-ref", "--format=" + fmt, "refs/heads", "refs/remotes"],
  })
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git for-each-ref exited with code ${r.code}`)
  const out: BranchItem[] = []
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue
    const f = line.split(FIELD)
    const ref = f[0]
    if (ref.endsWith("/HEAD")) continue
    const { ahead, behind } = parseTrack(f[5] || "")
    out.push({
      name: f[1],
      ref,
      head: f[2],
      current: f[3] === "*",
      remote: ref.startsWith("refs/remotes/"),
      upstream: f[4] || null,
      ahead,
      behind,
      author: f[6],
      date: Number(f[7]) * 1000,
      subject: f[8],
    })
  }
  return out
}

export async function readTags(info: RepoInfo, signal?: AbortSignal): Promise<string[]> {
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["tag", "--sort=-creatordate"],
  })
  if (r.code !== 0) return []
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function readRemotes(info: RepoInfo, signal?: AbortSignal): Promise<Array<{ name: string; url: string }>> {
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args: ["remote", "-v"] })
  if (r.code !== 0) return []
  const map = new Map<string, string>()
  for (const line of r.stdout.split("\n")) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)/.exec(line.trim())
    if (m && m[3] === "fetch" && !map.has(m[1])) map.set(m[1], m[2])
  }
  return [...map].map(([name, url]) => ({ name, url }))
}

/* ------------------------------------------------------------------ */
/* Write operations                                                    */
/* ------------------------------------------------------------------ */

function assertSafePaths(info: RepoInfo, paths: unknown): string[] {
  if (!Array.isArray(paths) || paths.length === 0) throw new RepoError("git/no-paths", "Missing file paths")
  const root = info.root
  return paths.map((p) => {
    if (typeof p !== "string" || p === "") throw new RepoError("git/bad-path", "Invalid path")
    const abs = path.resolve(root, p)
    const rel = path.relative(root, abs)
    if (rel.startsWith("..") || path.isAbsolute(rel))
      throw new RepoError("git/outside-repo", `Path is outside the repository: ${p}`)
    return p
  })
}

async function runWrite(info: RepoInfo, args: string[], signal?: AbortSignal): Promise<string> {
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args, timeoutMs: 120_000 })
  if (r.code !== 0)
    throw new Error(
      [r.stderr, r.stdout].find((s) => s && s.trim())?.trim() || `git ${args[0]} exited with code ${r.code}`,
    )
  return r.stdout
}

export async function stage(info: RepoInfo, paths: unknown, signal?: AbortSignal) {
  const safe = assertSafePaths(info, paths)
  await runWrite(info, ["add", "--", ...safe], signal)
  return { ok: true }
}

export async function unstage(info: RepoInfo, paths: unknown, signal?: AbortSignal) {
  const safe = assertSafePaths(info, paths)
  try {
    await runWrite(info, ["restore", "--staged", "--", ...safe], signal)
  } catch {
    await runWrite(info, ["reset", "HEAD", "--", ...safe], signal)
  }
  return { ok: true }
}

export async function discard(info: RepoInfo, payload: any, signal?: AbortSignal) {
  if (payload?.confirm !== true) throw new RepoError("git/needs-confirmation", "Discarding changes needs confirmation")
  const safe = assertSafePaths(info, payload?.paths)
  const untracked: string[] = []
  const tracked: string[] = []
  for (const p of safe) {
    const ls = await runGit(info.gitPath, {
      cwd: info.root,
      args: ["ls-files", "--error-unmatch", "--", p],
    })
    if (ls.code === 0) tracked.push(p)
    else untracked.push(p)
  }
  if (tracked.length) await runWrite(info, ["restore", "--worktree", "--", ...tracked], signal)
  if (untracked.length) await runWrite(info, ["clean", "-f", "--", ...untracked], signal)
  return { ok: true }
}

export async function commit(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const message = typeof payload?.message === "string" ? payload.message : ""
  if (!message.trim() && payload?.amend !== true)
    throw new RepoError("git/empty-message", "Please enter a commit message")
  const args = ["commit", "-m", message]
  if (payload?.amend === true) args.push("--amend")
  if (payload?.signoff === true) args.push("--signoff")
  if (typeof payload?.author === "string" && payload.author.trim()) args.push(`--author=${payload.author.trim()}`)
  if (payload?.all === true) args.push("-a")
  // Git forbids a pathspec ("partial") commit while a merge/rebase/cherry-pick is in progress.
  const op = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["rev-parse", "-q", "--verify", "MERGE_HEAD"],
  })
  const inMerge = op.code === 0
  if (payload?.amend !== true && !inMerge && Array.isArray(payload?.paths) && payload.paths.length)
    args.push("--", ...payload.paths.map(String))
  await runWrite(info, args, signal)
  const id = await runWrite(info, ["rev-parse", "HEAD"], signal)
  return { id: id.trim() }
}

export async function checkout(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const branch = String(payload?.branch ?? "")
  if (!branch) throw new RepoError("git/bad-branch", "Missing branch name")
  if (payload?.create === true) {
    const args = ["checkout", "-b", branch]
    if (payload?.start) args.push(String(payload.start))
    await runWrite(info, args, signal)
  } else {
    await runWrite(info, ["checkout", branch], signal)
  }
  return { ok: true }
}

export async function createBranch(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const name = String(payload?.name ?? "")
  if (!name) throw new RepoError("git/bad-branch", "Missing branch name")
  const args = ["branch", name]
  if (payload?.start) args.push(String(payload.start))
  await runWrite(info, args, signal)
  if (payload?.checkout === true) await runWrite(info, ["checkout", name], signal)
  return { ok: true }
}

export async function deleteBranch(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const name = String(payload?.name ?? "")
  if (!name) throw new RepoError("git/bad-branch", "Missing branch name")
  await runWrite(info, ["branch", payload?.force === true ? "-D" : "-d", name], signal)
  return { ok: true }
}

export async function merge(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const branch = String(payload?.branch ?? "")
  if (!branch) throw new RepoError("git/bad-branch", "Missing branch name")
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["merge", "--no-edit", branch],
    timeoutMs: 120_000,
  })
  return { ok: r.code === 0, output: [r.stdout, r.stderr].filter(Boolean).join("\n"), code: r.code }
}

export async function remoteOp(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const op = String(payload?.op ?? "fetch")
  const args =
    op === "push"
      ? [
          "push",
          ...(payload?.setUpstream ? ["-u"] : []),
          ...(payload?.remote ? [String(payload.remote)] : []),
          ...(payload?.branch ? [String(payload.branch)] : []),
        ]
      : op === "pull"
        ? ["pull", "--ff-only"]
        : ["fetch", "--all", "--prune"]
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args, timeoutMs: 300_000 })
  return { ok: r.code === 0, output: [r.stdout, r.stderr].filter(Boolean).join("\n"), code: r.code }
}

export interface HunkItem {
  index: number
  header: string
  patch: string
}

function splitDiffHunks(diff: string): {
  preamble: string
  hunks: Array<{ header: string; text: string }>
} {
  const lines = diff.split("\n")
  const pre: string[] = []
  const hunks: Array<{ header: string; text: string }> = []
  let cur: string[] | null = null
  for (const ln of lines) {
    if (ln.startsWith("@@")) {
      if (cur) hunks.push({ header: cur[0] || "", text: cur.join("\n") + "\n" })
      cur = [ln]
    } else if (cur) cur.push(ln)
    else pre.push(ln)
  }
  if (cur) hunks.push({ header: cur[0] || "", text: cur.join("\n") + "\n" })
  return { preamble: pre.join("\n"), hunks }
}

export async function listHunks(info: RepoInfo, payload: any, signal?: AbortSignal): Promise<HunkItem[]> {
  const file = String(payload?.file ?? "")
  if (!file) throw new RepoError("git/bad-path", "Missing file")
  const args = ["diff", "-U3", "--no-color"]
  if (payload?.staged === true) args.push("--cached")
  args.push("--", file)
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args, maxBuffer: 8 * 1024 * 1024 })
  if (r.code !== 0) return []
  const { preamble, hunks } = splitDiffHunks(r.stdout)
  return hunks.map((h, i) => ({ index: i, header: h.header, patch: preamble + "\n" + h.text })).filter((h) => h.header)
}

export async function applyHunks(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const file = String(payload?.file ?? "")
  const indexes: number[] = Array.isArray(payload?.indexes) ? payload.indexes.map(Number) : []
  if (!file || !indexes.length) throw new RepoError("git/bad-request", "Missing file/indexes")
  const stagedSource = payload?.staged === true // diff source = index (for unstage)
  const args = ["diff", "-U3", "--no-color"]
  if (stagedSource) args.push("--cached")
  args.push("--", file)
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args, maxBuffer: 8 * 1024 * 1024 })
  if (r.code !== 0) throw new Error(r.stderr.trim() || "diff failed")
  const { preamble, hunks } = splitDiffHunks(r.stdout)
  const chosen = indexes.map((i) => hunks[i]).filter(Boolean)
  if (!chosen.length) throw new RepoError("git/bad-range", "No such hunk")
  const patch = preamble + "\n" + chosen.map((h) => h.text).join("")
  const applyArgs = ["apply", "--cached", "--recount", "--whitespace=nowarn"]
  if (payload?.reverse === true) applyArgs.push("--reverse")
  applyArgs.push("-")
  const ap = await runGit(info.gitPath, { cwd: info.root, signal, args: applyArgs, input: patch })
  if (ap.code !== 0) throw new Error(ap.stderr.trim() || "git apply failed")
  return { ok: true }
}

export async function diffText(info: RepoInfo, payload: any, signal?: AbortSignal): Promise<string> {
  const args = ["diff", "--no-color"]
  if (payload?.staged === true) args.push("--cached")
  if (payload?.file) args.push("--", String(payload.file))
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args, maxBuffer: 8 * 1024 * 1024 })
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git diff exited with code ${r.code}`)
  return r.stdout
}

/** Both versions of one file, so the client can render split/unified and re-diff live. */
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg"])
const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
}

function isLfsPointer(buf: Buffer): boolean {
  return buf.length > 0 && buf.slice(0, 80).toString("utf8").startsWith("version https://git-lfs.github.com/spec/v1")
}

async function smudgeLfs(info: RepoInfo, buf: Buffer): Promise<Buffer> {
  if (!isLfsPointer(buf)) return buf
  try {
    const r = await runGitBytes(info.gitPath, {
      cwd: info.root,
      args: ["lfs", "smudge"],
      input: buf,
      timeoutMs: 20000,
    })
    if (r.code === 0 && r.stdout.length) return r.stdout
  } catch {}
  return buf
}

async function readBlob(info: RepoInfo, commit: string, file: string, signal?: AbortSignal): Promise<Buffer | null> {
  const r = await runGitBytes(info.gitPath, {
    cwd: info.root,
    args: ["show", `${commit}:${file}`],
    signal,
  })
  if (r.code !== 0) return null
  return isLfsPointer(r.stdout) ? smudgeLfs(info, r.stdout) : r.stdout
}

/** Both versions of one file: text lines, or image bytes (base64) for image diffs, with LFS smudge. */
export async function fileDiffText(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const file = String(payload?.file ?? "").trim()
  if (!file) throw new RepoError("git/bad-path", "Missing file path")
  const ext = path.extname(file).toLowerCase()
  const showBytes = async (revPath: string): Promise<Buffer> => {
    const r = await runGitBytes(info.gitPath, { cwd: info.root, args: ["show", revPath], signal })
    return r.code === 0 ? r.stdout : Buffer.alloc(0)
  }
  let oldBuf: Buffer
  let newBuf: Buffer
  let oldLabel = "HEAD"
  let newLabel = "Working Tree"
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
    oldLabel = "HEAD"
    newLabel = "Index"
  } else {
    oldBuf = await showBytes(`HEAD:${file}`)
    const abs = path.resolve(info.root, file)
    try {
      newBuf = fs.existsSync(abs) ? fs.readFileSync(abs) : Buffer.alloc(0)
    } catch {
      newBuf = Buffer.alloc(0)
    }
  }
  // LFS: smudge pointer blobs so images/contents show the real object.
  if (isLfsPointer(oldBuf)) {
    usedLfs = true
    oldBuf = await smudgeLfs(info, oldBuf)
  }
  if (isLfsPointer(newBuf)) {
    usedLfs = true
    newBuf = await smudgeLfs(info, newBuf)
  }
  const lfsInstalled = await hasLfs(info)

  if (IMAGE_EXT.has(ext)) {
    return {
      kind: "image",
      mime: MIME[ext] || "application/octet-stream",
      oldB64: oldBuf.length ? oldBuf.toString("base64") : "",
      newB64: newBuf.length ? newBuf.toString("base64") : "",
      oldLabel,
      newLabel,
      lfs: usedLfs,
      lfsInstalled,
    }
  }
  const binary = oldBuf.includes(0) || newBuf.includes(0)
  if (binary) return { kind: "binary", oldLabel, newLabel, lfs: usedLfs, lfsInstalled }
  return {
    kind: "text",
    oldText: oldBuf.toString("utf8"),
    newText: newBuf.toString("utf8"),
    oldLabel,
    newLabel,
    lfs: usedLfs,
    lfsInstalled,
  }
}

let lfsCache: boolean | undefined
export async function hasLfs(info: RepoInfo): Promise<boolean> {
  if (lfsCache !== undefined) return lfsCache
  try {
    const r = await runGit(info.gitPath, { cwd: info.root, args: ["lfs", "version"] })
    lfsCache = r.code === 0
  } catch {
    lfsCache = false
  }
  return lfsCache
}

export async function lfsLsFiles(info: RepoInfo, signal?: AbortSignal): Promise<string[]> {
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args: ["lfs", "ls-files", "-n"] })
  if (r.code !== 0) return []
  return r.stdout
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
}

export async function lfsInfo(_ctx: any): Promise<{ installed: boolean; version?: string }> {
  const gitPath = await resolveGitPath()
  if (!gitPath) return { installed: false }
  const r = await runGit(gitPath, { cwd: process.cwd(), args: ["lfs", "version"] })
  return { installed: r.code === 0, version: r.stdout.trim() || r.stderr.trim() }
}

export async function commitDiffText(info: RepoInfo, payload: any, signal?: AbortSignal): Promise<string> {
  const commit = String(payload?.commit ?? "")
  if (!commit) throw new RepoError("git/bad-commit", "Missing commit")
  const args = ["show", "--format=", "--no-color", "-M", commit]
  if (payload?.file) args.push("--", String(payload.file))
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

const SHELF_PREFIX = "shelf: "
export interface ShelfItem {
  index: number
  ref: string
  name: string
  date: number
}

export async function listShelves(info: RepoInfo, signal?: AbortSignal): Promise<ShelfItem[]> {
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["stash", "list", "--format=%gd%x1f%gs%x1f%ct"],
  })
  if (r.code !== 0) return []
  const out: ShelfItem[] = []
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue
    const f = line.split("\x1f")
    const msg = f[1] || ""
    if (!msg.includes(SHELF_PREFIX)) continue
    const m = /stash@\{(\d+)\}/.exec(f[0] || "")
    out.push({
      index: m ? Number(m[1]) : 0,
      ref: f[0] || "",
      name: msg.slice(msg.indexOf(SHELF_PREFIX) + SHELF_PREFIX.length),
      date: Number(f[2]) * 1000,
    })
  }
  return out
}

export async function shelfSave(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const name = String(payload?.name ?? "").trim() || "shelf"
  const args = ["stash", "push", "-u", "-m", SHELF_PREFIX + name]
  await runWrite(info, args, signal)
  return { ok: true }
}

export async function readStashes(info: RepoInfo, signal?: AbortSignal): Promise<StashItem[]> {
  const fmt = ["%gd", "%H", "%gs", "%ct", "%aN"].join(FIELD)
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["stash", "list", "--format=" + fmt],
  })
  if (r.code !== 0) return []
  const out: StashItem[] = []
  let i = 0
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue
    const f = line.split(FIELD)
    out.push({
      index: i++,
      ref: f[0],
      hash: f[1],
      message: f[2],
      date: Number(f[3]) * 1000,
      author: f[4],
    })
  }
  return out
}

export async function stashPush(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const args = ["stash", "push"]
  if (payload?.includeUntracked === true) args.push("-u")
  if (payload?.message) args.push("-m", String(payload.message))
  await runWrite(info, args, signal)
  return { ok: true }
}

export async function stashFiles(
  info: RepoInfo,
  payload: any,
  signal?: AbortSignal,
): Promise<Array<{ path: string; kind: string }>> {
  const ref = String(payload?.ref ?? (payload?.index != null ? `stash@{${Number(payload.index)}}` : "stash@{0}"))
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["diff", "--name-status", "--no-renames", `${ref}^`, ref],
  })
  if (r.code !== 0) return []
  const out: Array<{ path: string; kind: string }> = []
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue
    const f = line.split("\t")
    const st = (f[0] || "M")[0]
    const file = f[1]
    if (!file) continue
    out.push({ path: file, kind: st === "A" ? "added" : st === "D" ? "deleted" : "modified" })
  }
  return out
}

export async function stashApply(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const index = Number(payload?.index ?? 0)
  const verb = payload?.pop === true ? "pop" : "apply"
  await runWrite(info, ["stash", verb, `stash@{${index}}`], signal)
  return { ok: true }
}

export async function stashDrop(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const index = Number(payload?.index ?? 0)
  await runWrite(info, ["stash", "drop", `stash@{${index}}`], signal)
  return { ok: true }
}

export async function resolveConflict(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const file = String(payload?.file ?? "").trim()
  if (!file) throw new RepoError("git/bad-path", "Missing file path")
  const side = payload?.side === "theirs" ? "--theirs" : payload?.side === "ours" ? "--ours" : null
  if (side) await runWrite(info, ["checkout", side, "--", file], signal)
  await runWrite(info, ["add", "--", file], signal)
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
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["worktree", "list", "--porcelain"],
  })
  if (r.code !== 0) return []
  const items: WorktreeItem[] = []
  let cur: WorktreeItem | null = null
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur) items.push(cur)
      cur = {
        path: line.slice("worktree ".length),
        head: "",
        branch: null,
        bare: false,
        locked: false,
        prunable: false,
        current: false,
      }
    } else if (!cur) {
      continue
    } else if (line.startsWith("HEAD ")) {
      cur.head = line.slice(5)
    } else if (line.startsWith("branch ")) {
      cur.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "")
    } else if (line === "bare") {
      cur.bare = true
    } else if (line.startsWith("locked")) {
      cur.locked = true
    } else if (line.startsWith("prunable")) {
      cur.prunable = true
    }
  }
  if (cur) items.push(cur)
  const root = path.resolve(info.root)
  for (const it of items) it.current = samePath(it.path, root)
  return items
}

export async function worktreeMove(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const from = String(payload?.worktreePath ?? payload?.from ?? "").trim()
  const to = String(payload?.to ?? "").trim()
  if (!from || !to) throw new RepoError("git/bad-path", "Missing worktree move paths")
  await runWrite(info, ["worktree", "move", from, to], signal)
  return { ok: true }
}
export async function worktreeRepair(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const paths: string[] = Array.isArray(payload?.paths) ? payload.paths.map(String) : []
  await runWrite(info, ["worktree", "repair", ...paths], signal)
  return { ok: true }
}
export async function worktreeLock(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const target = String(payload?.worktreePath ?? payload?.target ?? "").trim()
  if (!target) throw new RepoError("git/bad-path", "Missing worktree path")
  if (payload?.lock === true) await runWrite(info, ["worktree", "lock", target], signal)
  else await runWrite(info, ["worktree", "unlock", target], signal)
  return { ok: true }
}
export async function worktreePrune(info: RepoInfo, payload: any, signal?: AbortSignal) {
  await runWrite(info, ["worktree", "prune"], signal)
  return { ok: true }
}
export async function addWorktree(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const target = String(payload?.worktreePath ?? payload?.target ?? "").trim()
  if (!target) throw new RepoError("git/bad-path", "Missing worktree path")
  const args = ["worktree", "add"]
  if (payload?.newBranch) args.push("-b", String(payload.newBranch))
  args.push(target)
  args.push(String(payload?.commitish || "HEAD"))
  await runWrite(info, args, signal)
  return { ok: true }
}

export async function removeWorktree(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const target = String(payload?.worktreePath ?? payload?.target ?? "").trim()
  if (!target) throw new RepoError("git/bad-path", "Missing worktree path")
  if (payload?.confirm !== true) throw new RepoError("git/needs-confirmation", "Removing a worktree needs confirmation")
  const args = ["worktree", "remove"]
  if (payload?.force === true) args.push("--force")
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
  const filePath = String(payload?.file ?? "").trim()
  if (!filePath) throw new RepoError("git/bad-path", "Missing file path")
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["blame", "--line-porcelain", "--", filePath],
    maxBuffer: 16 * 1024 * 1024,
  })
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git blame exited with code ${r.code}`)
  const out: BlameLine[] = []
  let sha = ""
  let line = 0
  let author = ""
  let time = 0
  let summary = ""
  for (const ln of r.stdout.split("\n")) {
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(ln)
    if (header) {
      sha = header[1]
      line = Number(header[2])
      author = ""
      time = 0
      summary = ""
      continue
    }
    if (ln.startsWith("\t")) {
      out.push({
        line,
        sha,
        shortSha: sha.slice(0, 7),
        author,
        time: time * 1000,
        summary,
        content: ln.slice(1),
      })
      continue
    }
    if (ln.startsWith("author ")) author = ln.slice(7)
    else if (ln.startsWith("author-time ")) time = Number(ln.slice(12)) || 0
    else if (ln.startsWith("summary ")) summary = ln.slice(8)
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
      return {
        isRepo: false,
        code: error.code,
        reason: error.message,
        directory: targetDirectory(ctx, payload) ?? null,
      }
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
      ? {
          head: status.head,
          upstream: status.upstream,
          ahead: status.ahead,
          behind: status.behind,
          detached: status.detached,
        }
      : null,
    operation,
  }
}

export async function abortOperation(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const op = (await currentOperation(info)) || String(payload?.operation ?? "")
  const args =
    op === "merge"
      ? ["merge", "--abort"]
      : op === "rebase"
        ? ["rebase", "--abort"]
        : op === "cherry-pick"
          ? ["cherry-pick", "--abort"]
          : null
  if (!args) throw new RepoError("git/no-operation", "No merge/rebase/cherry-pick in progress")
  await runWrite(info, args, signal)
  return { ok: true }
}

export async function resetCommit(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const commit = String(payload?.commit || "HEAD")
  const mode = payload?.mode === "hard" ? "hard" : payload?.mode === "mixed" ? "mixed" : "soft"
  if (mode === "hard" && payload?.confirm !== true)
    throw new RepoError("git/needs-confirmation", "Hard reset needs confirmation")
  await runWrite(info, ["reset", `--${mode}`, commit], signal)
  return { ok: true }
}

export async function revertMany(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const commits: string[] = Array.isArray(payload?.commits) ? payload.commits.map(String) : []
  if (!commits.length) throw new RepoError("git/bad-commit", "Missing commits")
  for (const c of [...commits].reverse()) await runWrite(info, ["revert", "--no-edit", c], signal)
  return { ok: true }
}

export async function revertCommit(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const commit = String(payload?.commit ?? "")
  if (!commit) throw new RepoError("git/bad-commit", "Missing commit")
  await runWrite(info, ["revert", "--no-edit", commit], signal)
  return { ok: true }
}

export async function cherryPick(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const commits: string[] = Array.isArray(payload?.commits)
    ? payload.commits.map(String)
    : payload?.commit
      ? [String(payload.commit)]
      : []
  if (!commits.length) throw new RepoError("git/bad-commit", "Missing commit")
  await runWrite(info, ["cherry-pick", ...commits], signal)
  return { ok: true }
}

export async function tagPush(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const name = String(payload?.name ?? "").trim()
  const remote = String(payload?.remote ?? "origin").trim()
  if (!name) throw new RepoError("git/bad-tag", "Missing tag name")
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["push", remote, name],
    timeoutMs: 120000,
  })
  return { ok: r.code === 0, output: [r.stdout, r.stderr].filter(Boolean).join("\n") }
}
export async function pullInto(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const remote = String(payload?.remote ?? "").trim()
  const branch = String(payload?.branch ?? "").trim()
  if (!remote || !branch) throw new RepoError("git/bad-ref", "Missing remote/branch")
  const args = ["pull", payload?.rebase === true ? "--rebase" : "--no-rebase", remote, branch]
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args, timeoutMs: 180000 })
  return { ok: r.code === 0, output: [r.stdout, r.stderr].filter(Boolean).join("\n") }
}
export async function tagCreate(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const name = String(payload?.name ?? "").trim()
  if (!name) throw new RepoError("git/bad-tag", "Missing tag name")
  const args = ["tag"]
  if (payload?.force === true) args.push("-f")
  if (payload?.message) args.push("-a", "-m", String(payload.message))
  args.push(name)
  if (payload?.commit) args.push(String(payload.commit))
  await runWrite(info, args, signal)
  return { ok: true }
}

export async function renameBranch(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const from = String(payload?.from ?? "").trim()
  const to = String(payload?.to ?? "").trim()
  if (!from || !to) throw new RepoError("git/bad-branch", "Missing branch name")
  await runWrite(info, ["branch", "-m", from, to], signal)
  return { ok: true }
}

export async function gitInit(payload: any): Promise<{ path: string }> {
  const directory = String(payload?.directory ?? "").trim()
  if (!directory) throw new RepoError("git/bad-path", "Missing directory")
  const gitPath = await resolveGitPath()
  if (!gitPath) throw new RepoError("git/not-found", "Git executable not found")
  fs.mkdirSync(directory, { recursive: true })
  const r = await runGit(gitPath, { cwd: directory, args: ["init"] })
  if (r.code !== 0) throw new Error(r.stderr.trim() || "git init failed")
  return { path: directory }
}

export async function cloneRepo(payload: any, signal?: AbortSignal): Promise<{ path: string }> {
  const url = String(payload?.url ?? "").trim()
  const parent = String(payload?.directory ?? "").trim()
  if (!url || !parent) throw new RepoError("git/bad-request", "Missing url/directory")
  const gitPath = await resolveGitPath()
  if (!gitPath) throw new RepoError("git/not-found", "Git executable not found")
  const base =
    url
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.git$/, "") || "repo"
  const target = path.join(parent, base)
  if (fs.existsSync(target) && fs.readdirSync(target).length)
    throw new RepoError("git/exists", `Directory not empty: ${target}`)
  fs.mkdirSync(parent, { recursive: true })
  const r = await runGit(gitPath, { cwd: parent, args: ["clone", "--", url, target], signal, timeoutMs: 600000 })
  if (r.code !== 0) throw new Error(r.stderr.trim() || "git clone failed")
  return { path: target }
}

export async function readIgnoreFile(info: RepoInfo, payload: any): Promise<{ path: string; content: string }> {
  const dest = payload?.destination === "exclude" ? "exclude" : "gitignore"
  const file = dest === "exclude" ? path.join(info.root, ".git", "info", "exclude") : path.join(info.root, ".gitignore")
  try {
    return { path: file, content: fs.readFileSync(file, "utf8") }
  } catch {
    return { path: file, content: "" }
  }
}

export async function writeIgnoreFile(info: RepoInfo, payload: any): Promise<{ ok: boolean; path: string }> {
  const dest = payload?.destination === "exclude" ? "exclude" : "gitignore"
  const file = dest === "exclude" ? path.join(info.root, ".git", "info", "exclude") : path.join(info.root, ".gitignore")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, String(payload?.content ?? ""))
  return { ok: true, path: file }
}

export async function addIgnore(info: RepoInfo, payload: any, _signal?: AbortSignal) {
  const files: string[] = Array.isArray(payload?.files) ? payload.files.map(String) : []
  if (!files.length) throw new RepoError("git/no-paths", "Missing paths")
  const destination = payload?.destination === "exclude" ? "exclude" : "gitignore"
  let target: string
  if (destination === "gitignore") {
    target = path.join(info.root, ".gitignore")
  } else {
    const dir = await gitDirOf(info)
    if (!dir) throw new RepoError("git/not-a-repository", "Not a repository")
    target = path.join(dir, "info", "exclude")
  }
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : ""
  const lines = new Set(existing.split("\n").map((l) => l.trim()))
  const added = files.filter((f) => !lines.has("/" + f) && !lines.has(f))
  if (added.length) {
    const prefix = existing && !existing.endsWith("\n") ? existing + "\n" : existing
    fs.writeFileSync(target, prefix + added.map((f) => "/" + f).join("\n") + "\n")
  }
  return { added }
}

export async function conflictDiff3(info: RepoInfo, payload: any, signal?: AbortSignal): Promise<{ text: string }> {
  const file = String(payload?.file ?? "").trim()
  if (!file) throw new RepoError("git/bad-path", "Missing file")
  const show = async (rev: string): Promise<Buffer | null> => {
    const r = await runGitBytes(info.gitPath, {
      cwd: info.root,
      args: ["show", `${rev}:${file}`],
      signal,
    })
    return r.code === 0 ? r.stdout : null
  }
  const base = await show(":1")
  const ours = await show(":2")
  const theirs = await show(":3")
  if (!base || !ours || !theirs) {
    try {
      return { text: fs.readFileSync(path.resolve(info.root, file), "utf8") }
    } catch {
      return { text: "" }
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dig-diff3-"))
  const w = (n: string, b: Buffer) => {
    const p = path.join(dir, n)
    fs.writeFileSync(p, b)
    return p
  }
  try {
    const r = await runGit(info.gitPath, {
      cwd: info.root,
      signal,
      args: ["merge-file", "-p", "--diff3", w("ours", ours), w("base", base), w("theirs", theirs)],
      maxBuffer: 16 * 1024 * 1024,
    })
    return { text: r.stdout }
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
}

export async function readConflictWorking(
  info: RepoInfo,
  payload: any,
  _signal?: AbortSignal,
): Promise<{ content: string }> {
  const file = String(payload?.file ?? "").trim()
  if (!file) throw new RepoError("git/bad-path", "Missing file path")
  try {
    return { content: fs.readFileSync(path.resolve(info.root, file), "utf8") }
  } catch {
    return { content: "" }
  }
}

export async function resolveConflictContent(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const file = String(payload?.file ?? "").trim()
  const content = String(payload?.content ?? "")
  if (!file) throw new RepoError("git/bad-path", "Missing file path")
  const abs = path.resolve(info.root, file)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  await runWrite(info, ["add", "--", file], signal)
  return { ok: true }
}

export async function conflictVersions(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const file = String(payload?.file ?? "").trim()
  if (!file) throw new RepoError("git/bad-path", "Missing file path")
  const get = async (stage: number): Promise<string> => {
    const r = await runGitBytes(info.gitPath, {
      cwd: info.root,
      args: ["show", `:${stage}:${file}`],
      signal,
    })
    return r.code === 0 ? r.stdout.toString("utf8") : ""
  }
  return { ours: await get(2), theirs: await get(3), base: await get(1) }
}

export async function undoCommit(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const target = String(payload?.commit ?? "HEAD~1")
  await runWrite(info, ["reset", "--soft", target], signal)
  return { ok: true }
}

export async function compareRefs(
  info: RepoInfo,
  payload: any,
  signal?: AbortSignal,
): Promise<Array<{ path: string; kind: string }>> {
  const fromRaw = String(payload?.from ?? "")
  const to = String(payload?.to ?? "HEAD")
  if (!fromRaw) throw new RepoError("git/bad-ref", "Missing from ref")
  const from = fromRaw === "ROOT" ? "4b825dc642cb6eb9a060e54bf8d69288fbee4904" : fromRaw
  const args = to === "WORKTREE" ? ["diff", "--name-status", "-M", from] : ["diff", "--name-status", "-M", from, to]
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args })
  if (r.code !== 0) throw new Error(r.stderr.trim() || "compare failed")
  const files: Array<{ path: string; kind: string }> = []
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue
    const p = line.split("\t")
    const letter = p[0][0]
    const kind =
      letter === "A"
        ? "added"
        : letter === "D"
          ? "deleted"
          : letter === "R"
            ? "renamed"
            : letter === "C"
              ? "copied"
              : "modified"
    files.push({ path: letter === "R" || letter === "C" ? (p[2] ?? p[1]) : p[1], kind })
  }
  return files
}

export async function refDiff(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const fromRaw = String(payload?.from ?? "")
  const to = String(payload?.to ?? "HEAD")
  const file = String(payload?.file ?? "")
  if (!fromRaw || !file) throw new RepoError("git/bad-ref", "Missing ref/file")
  const show = async (rev: string): Promise<string> => {
    if (rev === "ROOT") return ""
    const r = await runGitBytes(info.gitPath, {
      cwd: info.root,
      args: ["show", `${rev}:${file}`],
      signal,
    })
    return r.code === 0 ? r.stdout.toString("utf8") : ""
  }
  let newText: string
  if (to === "WORKTREE") {
    try {
      newText = fs.readFileSync(path.resolve(info.root, file), "utf8")
    } catch {
      newText = ""
    }
  } else newText = await show(to)
  return {
    oldText: await show(fromRaw),
    newText,
    oldLabel: fromRaw,
    newLabel: to === "WORKTREE" ? "Working Tree" : to,
  }
}

export async function remoteUrl(info: RepoInfo): Promise<{ url: string | null }> {
  const r = await runGit(info.gitPath, { cwd: info.root, args: ["remote", "get-url", "origin"] })
  return { url: r.code === 0 ? r.stdout.trim() : null }
}

export async function createPatch(info: RepoInfo, payload: any, signal?: AbortSignal): Promise<{ path: string }> {
  const commit = payload?.commit ? String(payload.commit) : null
  let out = ""
  if (commit) {
    const r = await runGit(info.gitPath, {
      cwd: info.root,
      signal,
      args: ["format-patch", "-1", "--stdout", commit],
      maxBuffer: 32 * 1024 * 1024,
    })
    out = r.stdout
  } else {
    const paths: string[] = Array.isArray(payload?.paths) ? payload.paths.map(String) : []
    const args = ["diff", "--no-color"]
    if (paths.length) args.push("--", ...paths)
    const r = await runGit(info.gitPath, {
      cwd: info.root,
      signal,
      args,
      maxBuffer: 32 * 1024 * 1024,
    })
    out = r.stdout
  }
  if (!out.trim()) throw new RepoError("git/empty-patch", "No changes to export")
  const dir = path.join(os.tmpdir(), "idea-git-patches")
  fs.mkdirSync(dir, { recursive: true })
  const name = `${(commit || "changes").slice(0, 8)}-${Date.now()}.patch`
  const target = path.join(dir, name)
  fs.writeFileSync(target, out)
  return { path: target }
}

function shq(p: string): string {
  return "'" + p.replace(/\\/g, "/").replace(/'/g, "'\\''") + "'"
}

async function listRange(info: RepoInfo, base: string | null, signal?: AbortSignal): Promise<string[]> {
  const range = base ? `${base}..HEAD` : "HEAD"
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["rev-list", "--reverse", "--end-of-options", range],
  })
  if (r.code !== 0) throw new Error(r.stderr.trim() || "rev-list failed")
  return r.stdout
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
}

interface PlanEntry {
  commit: string
  action: "pick" | "reword" | "squash" | "fixup" | "drop"
  message?: string
}

/** Port of OpenIDEA ops.rs interactive_rebase: write a todo (with exec amend lines) and run rebase -i. */
async function runRebasePlan(info: RepoInfo, base: string | null, entries: PlanEntry[], signal?: AbortSignal) {
  if (!entries.length) throw new RepoError("git/bad-commit", "No commits to rebase")
  const firstKept = entries.findIndex((e) => e.action !== "drop")
  if (firstKept < 0) throw new RepoError("git/bad-range", "At least one commit must be kept")
  if (entries[firstKept].action === "squash" || entries[firstKept].action === "fixup") {
    throw new RepoError("git/bad-range", "The first commit cannot be squashed or fixed up into a previous one")
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dig-rebase-"))
  const todo: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const verb = e.action === "reword" ? "pick" : e.action
    todo.push(`${verb} ${e.commit}`)
    const nextJoins = entries[i + 1] && (entries[i + 1].action === "squash" || entries[i + 1].action === "fixup")
    const msg = (e.message ?? "").trim()
    if (msg && (e.action === "reword" || e.action === "squash" || e.action === "pick")) {
      if (nextJoins) throw new RepoError("git/bad-range", "Set the message on the last commit of a squash group")
      const mf = path.join(dir, `msg-${i}`)
      fs.writeFileSync(mf, msg)
      todo.push(`exec git commit --amend --allow-empty --no-verify --quiet --cleanup=strip -F ${shq(mf)}`)
    }
  }
  const todoFile = path.join(dir, "todo")
  fs.writeFileSync(todoFile, todo.join("\n") + "\n")
  const seq = path.join(dir, "seq.mjs")
  fs.writeFileSync(
    seq,
    `import fs from 'node:fs'
import { createHash } from 'node:crypto'\nfs.copyFileSync(${JSON.stringify(todoFile)}, process.argv[2])\n`,
  )
  const noop = path.join(dir, "noop.mjs")
  fs.writeFileSync(noop, "// keep the editor buffer as-is\n")
  try {
    const args = ["rebase", "--interactive", "--autostash", "--no-autosquash", base || "--root"]
    const r = await runGit(info.gitPath, {
      cwd: info.root,
      signal,
      args,
      timeoutMs: 180000,
      env: {
        GIT_SEQUENCE_EDITOR: `"${process.execPath}" "${seq}"`,
        GIT_EDITOR: `"${process.execPath}" "${noop}"`,
      },
    })
    if (r.code === 0) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {}
    }
    return { ok: r.code === 0, output: [r.stdout, r.stderr].filter(Boolean).join("\n") }
  } catch (e) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
    throw e
  }
}

async function parentOf(info: RepoInfo, commit: string, signal?: AbortSignal): Promise<string | null> {
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["rev-list", "--parents", "-n", "1", commit],
  })
  const f = r.stdout.trim().split(/\s+/)
  return f.length > 1 ? f[1] : null
}

export async function editCommitMessage(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const commit = String(payload?.commit ?? "")
  const message = String(payload?.message ?? "")
  if (!commit) throw new RepoError("git/bad-commit", "Missing commit")
  if (!message.trim()) throw new RepoError("git/empty-message", "Empty message")
  const head = (await runGit(info.gitPath, { cwd: info.root, signal, args: ["rev-parse", "HEAD"] })).stdout.trim()
  if (commit === head) {
    await runWrite(info, ["commit", "--amend", "-m", message], signal)
    return { ok: true }
  }
  const base = await parentOf(info, commit, signal)
  const commits = base ? await listRange(info, base, signal) : await listRange(info, null, signal)
  const entries: PlanEntry[] = commits.map((c) =>
    c === commit ? { commit: c, action: "reword", message } : { commit: c, action: "pick" },
  )
  return runRebasePlan(info, base, entries, signal)
}

export async function prepareFixupCommit(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const message = String(payload?.message ?? "").trim()
  if (!message) throw new RepoError("git/empty-message", "Empty message")
  await runWrite(info, ["commit", "-a", "-m", message], signal)
  const id = await runWrite(info, ["rev-parse", "HEAD"], signal)
  return { id: id.trim() }
}

export async function squashRange(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const ids: string[] = Array.isArray(payload?.ids) ? payload.ids.map(String) : []
  const idSet = new Set(ids)
  if (idSet.size < 2) throw new RepoError("git/bad-commit", "Need at least two commits")
  // Oldest-first commits of the whole current history (like rebaseRange from HEAD).
  const all = await listRange(info, null, signal)
  const selected = all.filter((c) => idSet.has(c))
  if (selected.length !== idSet.size)
    throw new RepoError("git/bad-range", "Selected commits are not in the current branch")
  const base = await parentOf(info, selected[0], signal)
  const commits = base ? await listRange(info, base, signal) : all
  const first = commits.findIndex((c) => idSet.has(c))
  let combined = String(payload?.message ?? "").trim()
  if (!combined) {
    const parts: string[] = []
    for (const c of selected) {
      const m = await runGit(info.gitPath, {
        cwd: info.root,
        signal,
        args: ["show", "-s", "--format=%B", c],
      })
      if (m.stdout.trim()) parts.push(m.stdout.trim())
    }
    combined = parts.join("\n\n")
  }
  const entries: PlanEntry[] = []
  for (const c of commits.slice(0, first)) entries.push({ commit: c, action: "pick" })
  selected.forEach((c, i) => {
    if (i === 0) entries.push({ commit: c, action: "pick" })
    else
      entries.push({
        commit: c,
        action: "squash",
        ...(i === selected.length - 1 && combined ? { message: combined } : {}),
      })
  })
  for (const c of commits.slice(first + 1)) if (!idSet.has(c)) entries.push({ commit: c, action: "pick" })
  return runRebasePlan(info, base, entries, signal)
}

export async function dropCommit(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const commit = String(payload?.commit ?? "").trim()
  if (!commit) throw new RepoError("git/bad-commit", "Missing commit")
  const base = await parentOf(info, commit, signal)
  if (!base) throw new RepoError("git/bad-commit", "Cannot drop the root commit")
  const commits = await listRange(info, base, signal)
  if (!commits.includes(commit)) throw new RepoError("git/bad-range", "Commit not in current branch")
  const entries: PlanEntry[] = commits.map((c) => ({
    commit: c,
    action: c === commit ? "drop" : "pick",
  }))
  return runRebasePlan(info, base, entries, signal)
}

export async function interactiveRebase(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const base = payload?.base ? String(payload.base) : null
  const raw = Array.isArray(payload?.entries) ? payload.entries : []
  const entries: PlanEntry[] = raw.map((e: any) => ({
    commit: String(e.commit),
    action: e.action,
    message: e.message ? String(e.message) : undefined,
  }))
  return runRebasePlan(info, base, entries, signal)
}

export async function squashHead(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const log = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["log", "-2", "--pretty=format:%B%x1e"],
    maxBuffer: 4 * 1024 * 1024,
  })
  const recs = log.stdout
    .split("\x1e")
    .map((x) => x.replace(/^\n+/, "").trim())
    .filter(Boolean)
  if (recs.length < 2) throw new RepoError("git/bad-commit", "Need at least two commits to squash")
  const combined = `${recs[1]}\n\n${recs[0]}`.trim()
  await runWrite(info, ["reset", "--soft", "HEAD~2"], signal)
  await runWrite(info, ["commit", "-m", combined], signal)
  return { ok: true }
}

export async function dropHead(info: RepoInfo, payload: any, signal?: AbortSignal) {
  if (payload?.confirm !== true) throw new RepoError("git/needs-confirmation", "Dropping a commit needs confirmation")
  await runWrite(info, ["reset", "--hard", "HEAD~1"], signal)
  return { ok: true }
}

export async function remoteAdd(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const name = String(payload?.name ?? "").trim()
  const url = String(payload?.url ?? "").trim()
  if (!name || !url) throw new RepoError("git/bad-remote", "Missing remote name or url")
  await runWrite(info, ["remote", "add", name, url], signal)
  return { ok: true }
}
export async function remoteRemove(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const name = String(payload?.name ?? "").trim()
  if (!name) throw new RepoError("git/bad-remote", "Missing remote name")
  await runWrite(info, ["remote", "remove", name], signal)
  return { ok: true }
}
export async function remoteSetUrl(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const name = String(payload?.name ?? "").trim()
  const url = String(payload?.url ?? "").trim()
  if (!name || !url) throw new RepoError("git/bad-remote", "Missing remote name or url")
  await runWrite(info, ["remote", "set-url", name, url], signal)
  return { ok: true }
}
export async function rebase(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const onto = String(payload?.onto ?? "").trim()
  if (!onto) throw new RepoError("git/bad-ref", "Missing target")
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["rebase", onto],
    timeoutMs: 120000,
  })
  return { ok: r.code === 0, output: [r.stdout, r.stderr].filter(Boolean).join("\n") }
}

export async function tagDelete(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const name = String(payload?.name ?? "").trim()
  if (!name) throw new RepoError("git/bad-tag", "Missing tag name")
  await runWrite(info, ["tag", "-d", name], signal)
  return { ok: true }
}

export async function applyPatch(info: RepoInfo, payload: any, signal?: AbortSignal) {
  let text = typeof payload?.text === "string" ? payload.text : ""
  if (!text && payload?.path) {
    try {
      text = fs.readFileSync(String(payload.path), "utf8")
    } catch {}
  }
  if (!text.trim()) throw new RepoError("git/empty-patch", "No patch content")
  const check = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["apply", "--check", "-"],
    input: text,
  })
  if (check.code !== 0) throw new Error(check.stderr.trim() || "Patch does not apply")
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["apply", "-"],
    input: text,
  })
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Patch apply failed")
  return { ok: true }
}

export async function lfsMigrate(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const include = String(payload?.include ?? "").trim()
  if (!include) throw new RepoError("git/bad-pattern", "Missing include pattern")
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["lfs", "migrate", "import", `--include=${include}`, "--yes"],
    timeoutMs: 300000,
  })
  return { ok: r.code === 0, output: [r.stdout, r.stderr].filter(Boolean).join("\n") }
}

export async function lfsTrack(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const patterns: string[] = Array.isArray(payload?.patterns)
    ? payload.patterns.map(String)
    : payload?.pattern
      ? [String(payload.pattern)]
      : []
  if (!patterns.length) throw new RepoError("git/bad-pattern", "Missing patterns")
  await runWrite(info, ["lfs", "track", ...patterns], signal)
  return { ok: true }
}

export async function lfsUntrack(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const patterns: string[] = Array.isArray(payload?.patterns)
    ? payload.patterns.map(String)
    : payload?.pattern
      ? [String(payload.pattern)]
      : []
  if (!patterns.length) throw new RepoError("git/bad-pattern", "Missing patterns")
  await runWrite(info, ["lfs", "untrack", ...patterns], signal)
  return { ok: true }
}

export async function readWorktreeFile(info: RepoInfo, payload: any): Promise<{ content: string }> {
  const file = String(payload?.file ?? "").trim()
  if (!file) throw new RepoError("git/bad-path", "Missing file")
  try {
    return { content: fs.readFileSync(path.resolve(info.root, file), "utf8") }
  } catch {
    return { content: "" }
  }
}

export async function saveWorktreeFile(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const file = String(payload?.file ?? "").trim()
  const content = String(payload?.content ?? "")
  if (!file) throw new RepoError("git/bad-path", "Missing file")
  const abs = path.resolve(info.root, file)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  if (payload?.stage === true) await runWrite(info, ["add", "--", file], signal)
  return { ok: true }
}

export async function saveCommitFiles(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const dir = String(payload?.dir ?? "").trim()
  const commit = String(payload?.commit ?? "")
  const paths: string[] = Array.isArray(payload?.paths) ? payload.paths.map(String) : []
  if (!dir || !commit || !paths.length) throw new RepoError("git/bad-request", "Missing dir/commit/paths")
  fs.mkdirSync(dir, { recursive: true })
  if (paths.length === 1) {
    const file = paths[0]
    const buf = await readBlob(info, commit, file, signal)
    if (!buf) throw new Error(`Cannot read ${file}`)
    const target = path.join(dir, path.basename(file))
    fs.writeFileSync(target, buf)
    return { path: target }
  }
  const entries: Array<{ name: string; data: Buffer }> = []
  for (const p of paths) {
    const buf = await readBlob(info, commit, p, signal)
    if (buf) entries.push({ name: p, data: buf })
  }
  if (!entries.length) throw new RepoError("git/empty-patch", "No files to save")
  const target = path.join(dir, `${commit.slice(0, 7)}.zip`)
  fs.writeFileSync(target, zipStore(entries))
  return { path: target }
}

export async function commitFileBase64(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const commit = String(payload?.commit ?? "")
  const file = String(payload?.file ?? "")
  if (!commit || !file) throw new RepoError("git/bad-ref", "Missing commit/file")
  const buf = await readBlob(info, commit, file, signal)
  if (!buf) throw new Error(`Cannot read ${file} at ${commit}`)
  return { name: file.split("/").pop() || "file", base64: buf.toString("base64") }
}

export async function commitFilesZip(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const commit = String(payload?.commit ?? "")
  const paths: string[] = Array.isArray(payload?.paths) ? payload.paths.map(String) : []
  if (!commit || !paths.length) throw new RepoError("git/bad-ref", "Missing commit/paths")
  const entries: Array<{ name: string; data: Buffer }> = []
  for (const p of paths) {
    const buf = await readBlob(info, commit, p, signal)
    if (buf) entries.push({ name: p, data: buf })
  }
  if (!entries.length) throw new RepoError("git/empty-patch", "No files to zip")
  return { name: `${commit.slice(0, 7)}.zip`, base64: zipStore(entries).toString("base64") }
}

export async function cherryPickPaths(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const commit = String(payload?.commit ?? "")
  const paths: string[] = Array.isArray(payload?.paths) ? payload.paths.map(String) : []
  if (!commit || !paths.length) throw new RepoError("git/bad-ref", "Missing commit/paths")
  // Base is the first parent; a root commit has none, so diff against the empty tree.
  const parents = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["rev-list", "--parents", "-n", "1", commit],
  })
  const fields = parents.stdout.trim().split(/\s+/)
  const base = fields.length > 1 ? fields[1] : "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
  const diff = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["diff", "--no-color", base, commit, "--", ...paths],
    maxBuffer: 32 * 1024 * 1024,
  })
  if (diff.code !== 0 || !diff.stdout.trim()) throw new Error("No changes to cherry-pick for the selected files")
  const check = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["apply", "--check", "--index", "-"],
    input: diff.stdout,
  })
  if (check.code !== 0) throw new Error(check.stderr.trim() || "Selected changes do not apply cleanly")
  const apply = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["apply", "--index", "-"],
    input: diff.stdout,
  })
  if (apply.code !== 0) throw new Error(apply.stderr.trim() || "Cherry-pick apply failed")
  const msg = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["log", "-1", "--pretty=%B", commit],
  })
  const message = (msg.stdout.trim() || `cherry-pick ${commit.slice(0, 7)}`) + `\n\n(partial: ${paths.length} file(s))`
  await runWrite(info, ["commit", "-m", message], signal)
  return { ok: true }
}

export interface SubmoduleItem {
  path: string
  sha: string
  state: "ok" | "uninitialized" | "modified" | "conflict"
  describe: string
}

export async function readSubmodules(info: RepoInfo, signal?: AbortSignal): Promise<SubmoduleItem[]> {
  const r = await runGit(info.gitPath, {
    cwd: info.root,
    signal,
    args: ["submodule", "status", "--recursive"],
  })
  if (r.code !== 0) return []
  const out: SubmoduleItem[] = []
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue
    const flag = line[0]
    const rest = line.slice(1).trim()
    const m = /^([0-9a-f]+)\s+(\S+)(?:\s+\((.*)\))?$/.exec(rest)
    if (!m) continue
    const state = flag === "-" ? "uninitialized" : flag === "+" ? "modified" : flag === "U" ? "conflict" : "ok"
    out.push({ sha: m[1], path: m[2], state, describe: m[3] || "" })
  }
  return out
}

export async function submoduleUpdate(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const args = ["submodule", "update", "--init", "--recursive"]
  if (payload?.path) args.push("--", String(payload.path))
  await runWrite(info, args, signal)
  return { ok: true }
}

export async function lfsLocks(
  info: RepoInfo,
  signal?: AbortSignal,
): Promise<Array<{ path: string; owner: string; id?: string }>> {
  const r = await runGit(info.gitPath, { cwd: info.root, signal, args: ["lfs", "locks", "--json"] })
  if (r.code !== 0) return []
  try {
    const data = JSON.parse(r.stdout)
    const arr = Array.isArray(data?.locks) ? data.locks : []
    return arr.map((l: any) => ({
      path: String(l.path ?? ""),
      owner: String(l.owner?.name ?? ""),
      id: l.id ? String(l.id) : undefined,
    }))
  } catch {
    return []
  }
}

export async function lfsLock(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const p = String(payload?.path ?? "").trim()
  if (!p) throw new RepoError("git/bad-path", "Missing path")
  await runWrite(info, ["lfs", "lock", p], signal)
  return { ok: true }
}

export async function lfsUnlock(info: RepoInfo, payload: any, signal?: AbortSignal) {
  const p = String(payload?.path ?? "").trim()
  if (!p) throw new RepoError("git/bad-path", "Missing path")
  const args = ["lfs", "unlock", p]
  if (payload?.force === true) args.push("--force")
  await runWrite(info, args, signal)
  return { ok: true }
}

/* ---- Changelists: project-persisted grouping of local changes (port of ide-vcs/changelists.rs) ---- */
export interface Changelist {
  id: string
  name: string
  comment: string
}
export interface ChangelistState {
  lists: Changelist[]
  active: string
  files: Record<string, string>
}
const DEFAULT_LIST: Changelist = { id: "default", name: "Changes", comment: "" }

function projectStateDir(root: string) {
  const key =
    path.basename(root).replace(/[^a-zA-Z0-9._-]+/g, "_") +
    "-" +
    createHash("sha1").update(root).digest("hex").slice(0, 8)
  return path.join(os.homedir(), ".dsh-idea-git", key)
}
function changelistFile(root: string) {
  return path.join(projectStateDir(root), "changelists.json")
}
function normChangelists(st: any): ChangelistState {
  const lists: Changelist[] = Array.isArray(st?.lists) ? st.lists.filter((l: any) => l && l.id) : []
  const seen = new Set<string>()
  const uniq = lists
    .filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)))
    .map((l) => ({
      id: String(l.id),
      name: String(l.name ?? l.id),
      comment: String(l.comment ?? ""),
    }))
  if (!uniq.length) return { lists: [{ ...DEFAULT_LIST }], active: DEFAULT_LIST.id, files: {} }
  let active = String(st?.active ?? "")
  if (!uniq.some((l) => l.id === active)) active = uniq[0].id
  const ids = new Set(uniq.map((l) => l.id))
  const files: Record<string, string> = {}
  if (st?.files && typeof st.files === "object")
    for (const [k, v] of Object.entries(st.files)) if (ids.has(String(v))) files[k] = String(v)
  return { lists: uniq, active, files }
}

export async function changelistsLoad(info: RepoInfo): Promise<ChangelistState> {
  try {
    return normChangelists(JSON.parse(fs.readFileSync(changelistFile(info.root), "utf8")))
  } catch {
    return normChangelists(null)
  }
}

export async function changelistsSave(info: RepoInfo, payload: any): Promise<ChangelistState> {
  const state = normChangelists(payload?.state)
  const file = changelistFile(info.root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
  fs.renameSync(tmp, file)
  return state
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

export async function gitVersionInfo(ctx: any): Promise<{ found: boolean; path?: string; version?: string }> {
  const configured = (() => {
    try {
      return usable(ctx.get?.("ideaGitConfig")?.gitPath)
    } catch {
      return undefined
    }
  })()
  const gitPath = await resolveGitPath(configured)
  if (!gitPath) return { found: false }
  const r = await runGit(gitPath, { cwd: process.cwd(), args: ["--version"] })
  return { found: r.code === 0, path: gitPath, version: r.stdout.trim() || r.stderr.trim() }
}
