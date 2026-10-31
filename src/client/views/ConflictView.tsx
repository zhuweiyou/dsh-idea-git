/** Conflict resolution: compare ours vs theirs, accept a side or mark resolved. */
import React from 'react'
import { useGit, Icon, IconButton } from '../lib/ui'
import { useT } from '../lib/i18n'
import { computeRows } from '../lib/textdiff'
import * as store from '../store'

export function ConflictView({ bottom, theme }: { bottom: number; theme: 'light' | 'dark' }) {
  const s = useGit()
  const t = useT()
  const c = s.conflict
  const rows = React.useMemo(() => (c && !c.loading ? computeRows(c.ours, c.theirs, 'none') : []), [c])
  if (!c) return null
  return (
    <div className="dig-theme dig-diffarea" data-theme={theme} style={{ bottom }}>
      <div className="dig-diff__head">
        <Icon name="warning" size={15} style={{ color: 'var(--danger)' }} />
        <span className="dig-diff__title" title={c.file}>{t('Resolve Conflicts')}: {c.file}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="dig-btn" onClick={() => void store.resolveSide(c.file, 'ours')}>{t('Accept Ours')}</button>
        <button type="button" className="dig-btn" onClick={() => void store.resolveSide(c.file, 'theirs')}>{t('Accept Theirs')}</button>
        <button type="button" className="dig-btn dig-btn--primary" onClick={() => void store.resolveSide(c.file, 'mark')}>{t('Mark Resolved')}</button>
        <IconButton icon="close" title={t('Close')} onClick={() => store.closeConflict()} />
      </div>
      <div className="dig-conf__labels">
        <span className="dig-conf__label">{t('Ours')}</span>
        <span className="dig-conf__label">{t('Theirs')}</span>
      </div>
      <div className="dig-diff__body">
        {c.loading ? <div className="dig-empty">{t('Loading')}</div> : (
          <div className="dig-diff__split">
            {rows.map((r, i) => (
              <div key={i} className={'dig-dsrow dig-dsrow--' + r.kind}>
                <span className="dig-dsrow__no">{r.oldNo ?? ''}</span>
                <span className="dig-dsrow__cell dig-dsrow__cell--old">{r.oldNo != null ? (r.oldText || '\u00a0') : null}</span>
                <span className="dig-dsrow__no">{r.newNo ?? ''}</span>
                <span className="dig-dsrow__cell dig-dsrow__cell--new">{r.newNo != null ? (r.newText || '\u00a0') : null}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
