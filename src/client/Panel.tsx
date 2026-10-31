/** The bottom Git panel shell: tabs, branch menu, remote actions, resize, minimize/maximize/close. */
import React from 'react'
import { useGit, Icon, IconButton, Dropdown, MenuItem } from './lib/ui'
import { useT } from './lib/i18n'
import { useWindow, setHeight, toggleMaximized, toggleMinimized, closePanel } from './window'
import * as store from './store'
import { ChangesView } from './views/ChangesView'
import { LogView } from './views/LogView'
import { ConsoleView } from './views/ConsoleView'
import { StashView } from './views/StashView'
import { WorktreeView } from './views/WorktreeView'
import { DiffView } from './views/DiffView'
import { ContextMenuHost } from './lib/contextMenu'
import { PromptHost, askText } from './lib/prompt'

const TABS: Array<{ id: store.TabId; label: string }> = [
  { id: 'changes', label: 'Git' },
  { id: 'log', label: 'Log' },
  { id: 'console', label: 'Console' },
  { id: 'worktree', label: 'Worktrees' },
  { id: 'stash', label: 'Stash' },
]

function errorText(t: (s: string, p?: any) => string, code: string | null, fallback: string | null): string {
  switch (code) {
    case 'git/not-a-repository': return t('Not a Git repository')
    case 'git/not-found': return t('Git was not found. Install Git or set its path in the plugin settings.')
    case 'git/no-target': return t('No workspace is open yet.')
    case 'git/empty-message': return t('Please enter a commit message.')
    case 'idea-git/no-connection': return t('Connection to the Host is unavailable.')
    default: return fallback || t('Something went wrong')
  }
}

function ResizeHandle() {
  const w = useWindow()
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = w.height
    const move = (ev: PointerEvent) => setHeight(Math.max(140, Math.min(window.innerHeight - 80, startH + (startY - ev.clientY))))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return <div className="dig-panel__handle" role="separator" aria-orientation="horizontal" onPointerDown={startDrag} />
}

function Body() {
  const s = useGit()
  const t = useT()
  if (s.loading && !s.ready) return <div className="dig-empty">{t('Loading')}</div>
  if (s.info && s.info.isRepo === false) {
    return (
      <div className="dig-empty" style={{ flexDirection: 'column', gap: 8 }}>
        <Icon name="warning" size={22} style={{ color: 'var(--warning)' }} />
        <div>{errorText(t, s.info.code || null, s.info.reason || null)}</div>
        {s.info.directory ? <div style={{ color: 'var(--fg-subtle)', fontFamily: 'var(--font-mono)' }}>{s.info.directory}</div> : null}
        <button type="button" className="dig-btn" onClick={() => void store.refreshAll()}>{t('Retry')}</button>
      </div>
    )
  }
  switch (s.tab) {
    case 'changes': return <ChangesView />
    case 'log': return <LogView />
    case 'console': return <ConsoleView />
    case 'stash': return <StashView />
    case 'worktree': return <WorktreeView />
    default: return null
  }
}

export function Panel() {
  const w = useWindow()
  const s = useGit()
  const t = useT()
  React.useEffect(() => {
    if (!w.open) return
    const timer = setInterval(() => { try { void store.refreshSummary() } catch {} }, 5000)
    return () => clearInterval(timer)
  }, [w.open])
  React.useEffect(() => {
    if (!(s.diff || s.blame)) return
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') store.closeDiff() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s.diff, s.blame])
  if (!w.open) return null

  const height = w.maximized ? '100vh' : w.minimized ? 40 : w.height
  const bottom = w.minimized ? 40 : w.height
  const branch = s.info?.branch?.head
  const locals = s.branches.filter((b) => !b.remote)
  return (
    <>
      {!w.maximized && (s.diff || s.blame) ? <DiffView bottom={bottom} theme={w.theme} /> : null}
    <div className="dig-theme dig-panel" data-theme={w.theme} style={{ height }}>
      {!w.maximized && !w.minimized ? <ResizeHandle /> : null}
      <div className="dig-panel__header" onDoubleClick={() => toggleMaximized()}>
        <span className="dig-panel__brand">
          <Icon name="git" size={15} /> Git
        </span>
        <div className="dig-panel__tabs" role="tablist">
          {TABS.map((tab) => (
            <button key={tab.id} type="button" role="tab" className="dig-tab" data-active={s.tab === tab.id ? 'true' : undefined} onClick={() => store.setTab(tab.id)}>
              {t(tab.label)}
            </button>
          ))}
        </div>
        <div className="dig-panel__spacer" />
        {s.info?.isRepo ? (
          <Dropdown
            align="right"
            trigger={() => (
              <span className="dig-panel__branch" title={s.info?.branch?.upstream || branch || ''}>
                <Icon name="branch" size={13} />
                {branch || '—'}
                {s.info?.branch?.ahead ? <span> ↑{s.info.branch.ahead}</span> : null}
                {s.info?.branch?.behind ? <span> ↓{s.info.branch.behind}</span> : null}
                <Icon name="chevronDown" size={12} />
              </span>
            )}
          >
            {(close) => (
              <>
                {locals.map((b) => (
                  <MenuItem key={b.ref} checked={b.current} onClick={() => { close(); if (!b.current) void store.checkout(b.name) }}>
                    {b.name}
                  </MenuItem>
                ))}
                <MenuItem onClick={async () => { close(); const name = await askText(t('New branch name')); if (name) void store.checkout(name, true) }}>
                  {t('Create branch…')}
                </MenuItem>
              </>
            )}
          </Dropdown>
        ) : null}
        {s.info?.isRepo ? (
          <>
            <IconButton icon="cloud" size={17} title={t('Fetch')} onClick={() => void store.remoteOp('fetch')} />
            <IconButton icon="download" size={17} title={t('Pull')} onClick={() => void store.remoteOp('pull')} />
            <IconButton icon="upload" size={17} title={t('Push')} onClick={() => void store.remoteOp('push')} />
          </>
        ) : null}
        <IconButton icon="refresh" size={17} title={t('Refresh')} onClick={() => void store.refreshAll()} />
        <IconButton icon={w.minimized ? 'maximize' : 'minimize'} size={17} title={w.minimized ? t('Expand') : t('Minimize')} onClick={toggleMinimized} />
        <IconButton icon={w.maximized ? 'restore' : 'maximize'} size={17} title={w.maximized ? t('Restore') : t('Maximize')} onClick={toggleMaximized} />
        <IconButton icon="close" size={17} title={t('Close')} onClick={closePanel} />
      </div>
      {s.error && s.info?.isRepo !== false ? (
        <div className="dig-banner dig-banner--error">
          <Icon name="warning" size={14} />
          <span>{errorText(t, s.errorCode, s.error)}</span>
          <button type="button" className="dig-iconbtn dig-banner__close" title={t('Close')} onClick={() => store.dismissError()}>✕</button>
        </div>
      ) : null}
      {s.busy ? <div className="dig-banner dig-banner--busy">{t(s.busyLabel || 'Loading')}</div> : null}
      {!w.minimized ? (
        <div className="dig-panel__body">
          <Body />
        </div>
      ) : null}
    </div>
      <ContextMenuHost />
      <PromptHost theme={w.theme} />
    </>
  )
}
