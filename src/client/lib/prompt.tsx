/** In-app text prompt styled like an IDEA dialog (Electron has no window.prompt). */
import React from 'react'
import { Icon } from './ui'
import { t } from './i18n'

interface Pending { title: string; initial: string; multiline: boolean; resolve: (v: string | null) => void }
let pending: Pending | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => { try { f() } catch {} })

export function askText(title: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    pending = { title, initial, multiline: false, resolve }
    emit()
  })
}

export function askMultiline(title: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    pending = { title, initial, multiline: true, resolve }
    emit()
  })
}

function finish(v: string | null) {
  const p = pending
  pending = null
  emit()
  p?.resolve(v)
}

export function PromptHost({ theme }: { theme: 'light' | 'dark' }) {
  const p = React.useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb) }, () => pending)
  const [value, setValue] = React.useState('')
  const ref = React.useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  React.useEffect(() => {
    if (p) { setValue(p.initial); setTimeout(() => { ref.current?.focus(); ref.current?.select() }, 0) }
  }, [p])
  if (!p) return null
  const ok = () => { if (value.trim()) finish(value.trim()) }
  return (
    <div className="dig-theme dig-modal-mask" data-theme={theme} onMouseDown={() => finish(null)}>
      <div className="dig-dialog" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={p.title}>
        <div className="dig-dialog__titlebar">
          <span className="dig-dialog__title">{p.title}</span>
          <button type="button" className="dig-iconbtn" title="Close" onClick={() => finish(null)}><Icon name="close" size={14} /></button>
        </div>
        <div className="dig-dialog__body">
          {p.multiline ? (
            <textarea
              ref={ref as any}
              className="dig-dialog__textarea"
              rows={6}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ok() }
                else if (e.key === 'Escape') { e.preventDefault(); finish(null) }
              }}
            />
          ) : (
            <input
              ref={ref as any}
              className="dig-dialog__input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); ok() }
                else if (e.key === 'Escape') { e.preventDefault(); finish(null) }
              }}
            />
          )}
        </div>
        <div className="dig-dialog__footer">
          <button type="button" className="dig-btn" onClick={() => finish(null)}>{t('Cancel')}</button>
          <button type="button" className="dig-btn dig-btn--primary" disabled={!value.trim()} onClick={ok}>{t('OK')}</button>
        </div>
      </div>
    </div>
  )
}
