/** Minimal two-pane splitter (vertical or horizontal) for the panel views. */
import React from 'react'

export function SplitPane(props: {
  orientation: 'horizontal' | 'vertical'
  first: React.ReactNode
  second: React.ReactNode
  initial?: number // px of the anchored pane (first by default)
  min?: number
  max?: number
  anchor?: 'first' | 'second'
  storageKey?: string
}) {
  const horizontal = props.orientation === 'horizontal' // side by side
  const anchorSecond = props.anchor === 'second'
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [size, setSize] = React.useState<number>(() => {
    if (props.storageKey) {
      const v = Number(localStorage.getItem('dig.split.' + props.storageKey))
      if (v > 0) return v
    }
    return props.initial ?? 240
  })
  const sizeRef = React.useRef(size)
  sizeRef.current = size

  // Clamp the fixed first-pane size to the current container so the second pane
  // (e.g. commit details) never gets pushed off-screen after the window shrinks.
  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const clamp = () => {
      const rect = el.getBoundingClientRect()
      const minFirst = props.min ?? 120
      const avail = horizontal ? rect.width : rect.height
      const max = props.max ?? (horizontal ? avail - 180 : avail - 120)
      const hi = Math.max(minFirst, Math.min(max, avail - (horizontal ? 180 : 120)))
      setSize((s) => Math.max(minFirst, Math.min(s, hi)))
    }
    clamp()
    const ro = new ResizeObserver(clamp)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const move = (ev: PointerEvent) => {
      const raw = horizontal
        ? anchorSecond
          ? rect.right - ev.clientX
          : ev.clientX - rect.left
        : anchorSecond
          ? rect.bottom - ev.clientY
          : ev.clientY - rect.top
      const max = props.max ?? (horizontal ? rect.width - 180 : rect.height - 120)
      const next = Math.max(props.min ?? 120, Math.min(max, raw))
      setSize(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (props.storageKey) localStorage.setItem('dig.split.' + props.storageKey, String(sizeRef.current))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div ref={containerRef} className={'dig-split dig-split--' + (horizontal ? 'h' : 'v')}>
      <div
        className="dig-split__first"
        style={
          horizontal
            ? anchorSecond
              ? { flex: 1 }
              : { width: size }
            : anchorSecond
              ? { flex: 1 }
              : { height: size }
        }
      >
        {props.first}
      </div>
      <div className="dig-split__handle" role="separator" onPointerDown={onDown} />
      <div
        className="dig-split__second"
        style={
          horizontal
            ? anchorSecond
              ? { width: size, flex: 'none' }
              : undefined
            : anchorSecond
              ? { height: size, flex: 'none' }
              : undefined
        }
      >
        {props.second}
      </div>
    </div>
  )
}
