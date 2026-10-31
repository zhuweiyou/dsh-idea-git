/** Shared small UI pieces for the panel, matching OpenIDEA's visual language. */
import React from 'react'
import { getState, subscribe, type GitState } from '../store'
import type { FileKind } from '../types'
import { useT, t } from './i18n'

export function useGit(): GitState {
  return React.useSyncExternalStore(subscribe, getState)
}

/* ---------------------------- icons ---------------------------- */

import { Icon } from '../vendor/ui/IconAdapter'
export { Icon }

/* ---------------------------- controls ---------------------------- */

const ICON_LABELS: Record<string, string> = {
  refresh: 'Refresh', plus: 'Add', minus: 'Remove', undo: 'Rollback', commit: 'Commit', eye: 'View Options', list: 'List',
  more: 'More', download: 'Pull', upload: 'Push', cloud: 'Fetch', trash: 'Delete', close: 'Close', maximize: 'Maximize',
  restore: 'Restore', minimize: 'Minimize', chevronDown: 'Expand', chevronRight: 'Expand', chevronLeft: 'Collapse',
  branch: 'Branch', tag: 'Tag', search: 'Search', history: 'History', sparkle: 'Generate', lock: 'Lock', stash: 'Stash',
  warning: 'Warning', 'arrow-up': 'Move Up', 'arrow-down': 'Move Down', edit: 'Edit', split: 'Split', 'collapse-all': 'Collapse All',
  folder: 'Folder', file: 'File', star: 'Favorite', starOutline: 'Add to Favorites', target: 'Navigate',
}

export function IconButton(props: { icon: string; title?: string; size?: number; disabled?: boolean; active?: boolean; onClick?: (e: React.MouseEvent) => void }) {
  const t = useT()
  const title = props.title || t(ICON_LABELS[props.icon] || props.icon)
  return (
    <button
      type="button"
      className="dig-iconbtn"
      data-active={props.active ? 'true' : undefined}
      title={title}
      aria-label={title}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={props.size ?? 16} />
    </button>
  )
}

export function Button(props: { children: React.ReactNode; primary?: boolean; disabled?: boolean; title?: string; onClick?: () => void; className?: string }) {
  return (
    <button
      type="button"
      className={'dig-btn' + (props.primary ? ' dig-btn--primary' : '') + (props.className ? ' ' + props.className : '')}
      disabled={props.disabled}
      title={props.title}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

export function Checkbox(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="dig-check">
      <span className="dig-check__box" data-on={props.checked ? 'true' : undefined} onClick={() => props.onChange(!props.checked)}>
        {props.checked ? <Icon name="check" size={11} /> : null}
      </span>
      <span className="dig-check__label">{props.label}</span>
    </label>
  )
}

export function Dropdown(props: { trigger: (open: boolean) => React.ReactNode; children: (close: () => void) => React.ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div className="dig-dropdown" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{props.trigger(open)}</div>
      {open ? <div className={'dig-menu' + (props.align === 'right' ? ' dig-menu--right' : '')}>{props.children(() => setOpen(false))}</div> : null}
    </div>
  )
}

export function MenuItem(props: { children: React.ReactNode; onClick?: () => void; checked?: boolean; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" className={'dig-menuitem' + (props.danger ? ' dig-menuitem--danger' : '')} disabled={props.disabled} onClick={props.onClick}>
      <span className="dig-menuitem__check">{props.checked ? <Icon name="check" size={12} /> : null}</span>
      <span className="dig-menuitem__label">{props.children}</span>
    </button>
  )
}

/* ---------------------------- helpers ---------------------------- */

export function baseName(p: string): string {
  const i = p.replace(/\\/g, '/').lastIndexOf('/')
  return i < 0 ? p : p.slice(i + 1)
}
export function dirName(p: string): string {
  const i = p.replace(/\\/g, '/').lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}
export function kindColor(kind: FileKind): string {
  switch (kind) {
    case 'added': case 'untracked': return 'var(--vcs-added)'
    case 'deleted': return 'var(--vcs-deleted)'
    case 'conflicted': return 'var(--danger)'
    case 'renamed': case 'copied': return 'var(--vcs-modified)'
    case 'ignored': return 'var(--vcs-ignored)'
    default: return 'var(--vcs-modified)'
  }
}
export function kindLetter(kind: FileKind): string {
  switch (kind) {
    case 'added': return 'A'
    case 'deleted': return 'D'
    case 'renamed': return 'R'
    case 'copied': return 'C'
    case 'untracked': return 'U'
    case 'conflicted': return '!'
    case 'ignored': return 'I'
    case 'typechange': return 'T'
    default: return 'M'
  }
}
export function formatDate(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export function relTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return t('Just now')
  if (min < 60) return t('{n} minutes ago', { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('{n} hours ago', { n: hr })
  const day = Math.floor(hr / 24)
  if (day < 30) return t('{n} days ago', { n: day })
  return formatDate(ts).slice(0, 10)
}

export function fileIconColor(name: string): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''
  const map: Record<string, string> = {
    '.js': '#d9b44a', '.jsx': '#d9b44a', '.mjs': '#d9b44a', '.cjs': '#d9b44a',
    '.ts': '#4f9cd6', '.tsx': '#4f9cd6',
    '.json': '#c9b048', '.json5': '#c9b048',
    '.css': '#5aa7d6', '.scss': '#d6729c', '.less': '#5aa7d6',
    '.html': '#e37933', '.htm': '#e37933', '.vue': '#42b883',
    '.md': '#83b3d6', '.markdown': '#83b3d6',
    '.yml': '#9d7bd8', '.yaml': '#9d7bd8', '.toml': '#9d7bd8',
    '.png': '#a074c4', '.jpg': '#a074c4', '.jpeg': '#a074c4', '.gif': '#a074c4', '.svg': '#a074c4', '.webp': '#a074c4',
    '.sh': '#7bbf6a', '.py': '#4f9cd6', '.go': '#4fc3d6', '.rs': '#d79b6e', '.java': '#d6729c',
  }
  return map[ext] || 'var(--fg-subtle)'
}
