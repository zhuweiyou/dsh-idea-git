/**
 * Git process layer for dsh-idea-git.
 *
 * Every git invocation goes through `runGit` so one place owns: the forced
 * configuration (`core.quotepath=false` so non-ASCII paths survive, no pager, no
 * color), output decoding, timeouts, cancellation and the console ring buffer
 * that the panel's Console tab reads.
 */
import { spawn } from "node:child_process"
import os from "node:os"

export interface CmdResult {
  code: number
  stdout: string
  stderr: string
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

const MAX_BUFFER = 16 * 1024 * 1024
const DEFAULT_TIMEOUT = 30_000
const consoleLog: ConsoleEntry[] = []
let consoleSeq = 0

const FORCED_CONFIG = [
  "-c",
  "core.quotepath=false",
  "-c",
  "color.ui=false",
  "-c",
  "core.pager=cat",
  "-c",
  "advice.detachedHead=false",
]

let cachedGitPath: string | null | undefined

export async function resolveGitPath(configured?: string | null): Promise<string | null> {
  const explicit = (configured ?? process.env.IDEA_GIT_PATH ?? "").trim()
  if (explicit) return explicit
  if (cachedGitPath !== undefined) return cachedGitPath
  const candidates = ["git"]
  if (process.platform === "win32") {
    candidates.push(
      "C:\\Program Files\\Git\\cmd\\git.exe",
      "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
      "C:\\Program Files\\Git\\bin\\git.exe",
    )
  }
  for (const candidate of candidates) {
    try {
      const r = await spawnProc(candidate, ["--version"], { cwd: os.homedir(), timeoutMs: 8000 })
      if (r.code === 0) {
        cachedGitPath = candidate
        return cachedGitPath
      }
    } catch {}
  }
  cachedGitPath = null
  return cachedGitPath
}

export function clearGitPathCache() {
  cachedGitPath = undefined
}

interface RunOptions {
  cwd: string
  signal?: AbortSignal
  timeoutMs?: number
  input?: string
  env?: Record<string, string>
  maxBuffer?: number
  write?: boolean
}

function spawnProc(exe: string, args: string[], opts: RunOptions): Promise<CmdResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...(opts.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    let outLen = 0
    let errLen = 0
    let settled = false
    const max = opts.maxBuffer ?? MAX_BUFFER
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {}
      finish({
        code: 124,
        stdout,
        stderr: stderr + `\n[timeout after ${opts.timeoutMs ?? DEFAULT_TIMEOUT}ms]`,
      })
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT)
    const onAbort = () => {
      try {
        child.kill("SIGKILL")
      } catch {}
      finish({ code: 130, stdout, stderr: stderr + "\n[cancelled]" })
    }
    if (opts.signal) {
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener("abort", onAbort, { once: true })
    }
    function finish(r: CmdResult) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener("abort", onAbort)
      resolve(r)
    }
    child.stdout.on("data", (d: Buffer) => {
      outLen += d.length
      if (outLen > max) {
        try {
          child.kill("SIGKILL")
        } catch {}
        stderr += "\n[stdout truncated]"
        return
      }
      stdout += d.toString("utf8")
    })
    child.stderr.on("data", (d: Buffer) => {
      errLen += d.length
      if (errLen > max) return
      stderr += d.toString("utf8")
    })
    child.on("error", (e) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(e)
      }
    })
    child.on("close", (code) => finish({ code: code ?? 0, stdout, stderr }))
    if (opts.input !== undefined) {
      child.stdin.write(opts.input)
    }
    child.stdin.end()
  })
}

export async function runGit(
  gitPath: string,
  opts: RunOptions & { args: string[] },
): Promise<CmdResult> {
  const start = Date.now()
  const args = [...FORCED_CONFIG, ...opts.args]
  let result: CmdResult
  try {
    result = await spawnProc(gitPath, args, opts)
  } catch (error) {
    result = {
      code: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
  const entry: ConsoleEntry = {
    id: ++consoleSeq,
    at: start,
    cwd: opts.cwd,
    command: `git ${opts.args.join(" ")}`,
    code: result.code,
    durationMs: Date.now() - start,
    stdout: result.stdout.length > 200_000 ? result.stdout.slice(0, 200_000) : result.stdout,
    stderr: result.stderr,
  }
  consoleLog.push(entry)
  if (consoleLog.length > 300) consoleLog.shift()
  return result
}

/** Run a read-only git command and throw on a non-zero exit. */
export async function gitOrThrow(
  gitPath: string,
  opts: RunOptions & { args: string[] },
): Promise<string> {
  const r = await runGit(gitPath, { ...opts, args: ["--no-optional-locks", ...opts.args] })
  if (r.code !== 0) throw gitError(r, opts.args)
  return r.stdout
}

export function gitError(
  r: CmdResult,
  args: string[],
): Error & { code?: string; detail?: unknown } {
  const text =
    [r.stderr, r.stdout].find((s) => s && s.trim())?.trim() ||
    `git ${args.join(" ")} exited ${r.code}`
  const error = new Error(text) as Error & { code?: string; detail?: unknown }
  error.code = "git/command-failed"
  error.detail = { args, code: r.code }
  return error
}

export function readConsole(): ConsoleEntry[] {
  return consoleLog.slice()
}

export function clearConsole() {
  consoleLog.length = 0
}

/** Run git and collect raw bytes (for images / binary blobs). */
export function runGitBytes(
  gitPath: string,
  opts: { cwd: string; args: string[]; input?: Buffer; timeoutMs?: number; signal?: AbortSignal },
): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(gitPath, [...FORCED_CONFIG, ...opts.args], {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    const chunks: Buffer[] = []
    let stderr = ""
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {}
      resolve({ code: 124, stdout: Buffer.concat(chunks), stderr })
    }, opts.timeoutMs ?? 30000)
    if (opts.signal)
      opts.signal.addEventListener(
        "abort",
        () => {
          try {
            child.kill("SIGKILL")
          } catch {}
        },
        { once: true },
      )
    child.stdout.on("data", (d: Buffer) => chunks.push(d))
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8")
    })
    child.on("error", (e) => {
      clearTimeout(timer)
      resolve({ code: 127, stdout: Buffer.concat(chunks), stderr: String(e) })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 0, stdout: Buffer.concat(chunks), stderr })
    })
    if (opts.input) child.stdin.write(opts.input)
    child.stdin.end()
  })
}
