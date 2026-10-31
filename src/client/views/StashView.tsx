/** Stash view: list stashes and stash/apply/pop/drop. */
import React from 'react'
import { useGit, Icon, IconButton, Button, formatDate } from '../lib/ui'
import { useT } from '../lib/i18n'
import * as store from '../store'
import { openContextMenu } from '../lib/contextMenu'

export function StashView() {
  const s = useGit()
  const t = useT()
  React.useEffect(() => {
    void store.loadStashes()
  }, [])
  return (
    <div className="dig-stash">
      <div className="dig-toolbar">
        <IconButton icon="refresh" title={t('Refresh')} onClick={() => void store.loadStashes()} />
        <button type="button" className="dig-btn" onClick={() => void store.stashAll()}>⟱ {t('Stash changes')}</button>
        <span className="dig-toolbar__sep" />
        <span className="dig-toolbar__hint">{t('{n} stashes', { n: s.stashes.length })}</span>
        <span style={{ flex: 1 }} />
      </div>
      <div className="dig-stash__list">
        {s.stashes.length === 0 ? <div className="dig-empty">{t('No stashes')}</div> : null}
        {s.stashes.map((st) => (
          <div className="dig-stashrow" key={st.ref}>
            <Icon name="stash" size={14} style={{ color: 'var(--fg-subtle)' }} />
            <div className="dig-stashrow__main">
              <div className="dig-stashrow__msg" title={st.message}>{st.message}</div>
              <div className="dig-stashrow__meta">{formatDate(st.date)} · {st.author}</div>
            </div>
            <div className="dig-stashrow__actions">
              <button type="button" className="dig-btn" onClick={async (ev) => {
                const files = await store.listStashFiles(st.index, st.ref)
                if (!files.length) return
                if (files.length === 1) { void store.openStashFileDiff(st.ref, files[0].path); return }
                openContextMenu(ev as any, files.map((f) => ({ label: f.path, run: () => void store.openStashFileDiff(st.ref, f.path) })))
              }}>{t('Diff')}</button>
              <Button onClick={() => void store.stashApply(st.index, false)}>{t('Apply')}</Button>
              <Button onClick={() => void store.stashApply(st.index, true)}>{t('Pop')}</Button>
              <IconButton icon="trash" title={t('Drop')} onClick={() => { if (window.confirm(t('Drop this stash?'))) void store.stashDrop(st.index) }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
