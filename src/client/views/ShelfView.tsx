/** Shelf view: named stashes. */
import React from 'react'
import { useGit, Icon, IconButton, Button, formatDate } from '../lib/ui'
import { useT } from '../lib/i18n'
import { askText } from '../lib/prompt'
import * as store from '../store'

export function ShelfView() {
  const s = useGit()
  const t = useT()
  React.useEffect(() => { void store.loadShelves() }, [])
  return (
    <div className="dig-stash">
      <div className="dig-toolbar">
        <IconButton icon="refresh" title={t('Refresh')} onClick={() => void store.loadShelves()} />
        <button type="button" className="dig-btn" onClick={async () => { const n = await askText(t('Shelf name')); if (n) void store.shelfSave(n) }}>＋ {t('Shelve…')}</button>
        <span style={{ flex: 1 }} />
        <span className="dig-toolbar__hint">{t('{n} shelves', { n: s.shelves.length })}</span>
      </div>
      <div className="dig-stash__list">
        {s.shelves.length === 0 ? <div className="dig-empty">{t('No shelves')}</div> : null}
        {s.shelves.map((it) => (
          <div className="dig-stashrow" key={it.ref}>
            <Icon name="stash" size={14} style={{ color: 'var(--fg-subtle)' }} />
            <div className="dig-stashrow__main">
              <div className="dig-stashrow__msg" title={it.name}>{it.name}</div>
              <div className="dig-stashrow__meta">{formatDate(it.date)}</div>
            </div>
            <div className="dig-stashrow__actions">
              <Button onClick={() => void store.shelfApply(it.index, false)}>{t('Apply')}</Button>
              <Button onClick={() => void store.shelfApply(it.index, true)}>{t('Pop')}</Button>
              <IconButton icon="trash" title={t('Drop')} onClick={() => { if (window.confirm(t('Drop this shelf?'))) void store.shelfDrop(it.index) }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
