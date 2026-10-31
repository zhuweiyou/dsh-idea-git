/** Per-workspace panel state: switching workspaces preserves each one's panel. */
import { snapshotWindow, restoreWindow, type WindowState } from "./window"
import { snapshotState, restoreState, type GitState } from "./store"

interface Entry {
  win: WindowState
  st: GitState
}
const saved = new Map<string, Entry>()
let currentKey = ""

const lsKey = (key: string) => "dig.ws." + encodeURIComponent(key)
function loadWin(key: string): WindowState | null {
  try {
    const raw = localStorage.getItem(lsKey(key))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function saveWin(key: string, win: WindowState) {
  try {
    localStorage.setItem(lsKey(key), JSON.stringify(win))
  } catch {}
}

/** Save the current workspace's panel state and restore the target workspace's. */
export function switchWorkspace(key: string) {
  if (!key) return
  if (key === currentKey) return
  const win = snapshotWindow()
  if (currentKey) {
    saved.set(currentKey, { win, st: snapshotState() })
    saveWin(currentKey, win)
  }
  const target = saved.get(key)
  currentKey = key
  if (target) {
    restoreWindow(target.win)
    restoreState(target.st)
    return
  }
  // First visit in this app run: start closed, but reuse any persisted geometry.
  const persisted = loadWin(key)
  restoreWindow({
    ...win,
    open: false,
    minimized: false,
    maximized: false,
    target: null,
    ...(persisted ? { height: persisted.height } : {}),
  })
}

export function currentWorkspaceKey() {
  return currentKey
}

export function saveCurrentWorkspace() {
  if (currentKey) saveWin(currentKey, snapshotWindow())
}
