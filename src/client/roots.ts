/** All known workspace repositories, selectable in the panel header (multi-root). */
import React from 'react'

export interface RepoRoot { id: string; label: string; path: string }
let roots: RepoRoot[] = []
const subs = new Set<() => void>()

export function setRepoRoots(next: RepoRoot[]) {
  const seen = new Set<string>()
  roots = next.filter((r) => r.path && !seen.has(r.path) && (seen.add(r.path), true))
  subs.forEach((f) => { try { f() } catch {} })
}
export function getRepoRoots() { return roots }
export function useRepoRoots(): RepoRoot[] {
  return React.useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb) }, getRepoRoots)
}
