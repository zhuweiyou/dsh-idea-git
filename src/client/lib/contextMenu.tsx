/** A small fixed-position context menu shared by the panel views. */
import React from 'react'

export interface CtxItem {
  label?: string
  run?: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

interface CtxState {
  open: boolean
  x: number
  y: number
  items: CtxItem[]
}

let state: CtxState = { open: false, x: 0, y: 0, items: [] }
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => { try { f() } catch {} })

export function openContextMenu(e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: CtxItem[]) {
  try { e.preventDefault?.() } catch {}
  try { e.stopPropagation?.() } catch {}
  state = { open: true, x: e.clientX, y: e.clientY, items }
  emit()
}

export function closeContextMenu() {
  if (state.open) {
    state = { ...state, open: false }
    emit()
  }
}

export function copyText(text: string) {
  try { void navigator.clipboard?.writeText(text) } catch {}
}

export function ContextMenuHost() {
  const s = React.useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb) },
    () => state,
  )
  React.useEffect(() => {
    if (!s.open) return
    const onDown = () => closeContextMenu()
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeContextMenu() }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [s.open])
  if (!s.open) return null
  const width = 220
  const height = s.items.length * 26 + 12
  const x = Math.max(4, Math.min(s.x, window.innerWidth - width - 6))
  const y = Math.max(4, Math.min(s.y, window.innerHeight - height - 6))
  return (
    <div className="dig-ctxmenu" style={{ left: x, top: y, minWidth: width }} onMouseDown={(e) => e.stopPropagation()}>
      {s.items.map((it, i) =>
        it.separator ? (
          <div key={i} className="dig-ctxmenu__sep" />
        ) : (
          <button
            key={i}
            type="button"
            className={'dig-ctxmenu__item' + (it.danger ? ' dig-ctxmenu__item--danger' : '')}
            disabled={it.disabled}
            onClick={() => { closeContextMenu(); it.run?.() }}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  )
}
