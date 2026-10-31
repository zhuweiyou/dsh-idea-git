/** Window shell state (open/minimized/maximized/height/theme + current target). */
import React from 'react'

export interface Target {
  sessionId: string
  directory: string
}

export interface WindowState {
  open: boolean
  minimized: boolean
  maximized: boolean
  height: number
  theme: 'light' | 'dark'
  target: Target | null
}

function readHeight(): number {
  const v = Number(localStorage.getItem('dig.panelHeight'))
  return v > 0 ? v : 340
}

let state: WindowState = {
  open: false,
  minimized: false,
  maximized: false,
  height: readHeight(),
  theme: 'dark',
  target: null,
}
const subs = new Set<() => void>()

export function subscribeWindow(fn: () => void): () => void {
  subs.add(fn)
  return () => subs.delete(fn)
}
export function getWindow(): WindowState {
  return state
}

export function snapshotWindow(): WindowState {
  return state
}

export function restoreWindow(snap: WindowState | null | undefined) {
  if (snap) set(snap)
}
function set(patch: Partial<WindowState>) {
  state = { ...state, ...patch }
  subs.forEach((f) => {
    try { f() } catch {}
  })
}
export function useWindow(): WindowState {
  return React.useSyncExternalStore(subscribeWindow, getWindow)
}

export function setTheme(theme: 'light' | 'dark') {
  if (state.theme !== theme) set({ theme })
}
export function setHeight(height: number) {
  localStorage.setItem('dig.panelHeight', String(Math.round(height)))
  set({ height })
}
export function setTarget(target: Target | null) {
  set({ target })
}
export function openPanel() {
  set({ open: true, minimized: false })
}
export function closePanel() {
  set({ open: false })
}
export function togglePanel() {
  set({ open: !state.open, minimized: false })
}
export function toggleMinimized() {
  set({ minimized: !state.minimized })
}
export function toggleMaximized() {
  set({ maximized: !state.maximized, minimized: false })
}
