/** Branch/ref comparison: changed files on the left, diff on the right. */
import React from 'react'
import { useGit, Icon, IconButton } from '../lib/ui'
import { useT } from '../lib/i18n'
import { computeRows } from '../lib/textdiff'
import * as store from '../store'

export function CompareView({ bottom, theme }: { bottom: number; theme: 'light' | 'dark' }) {
  const s = useGit()
  const t = useT()
  const c = s.compare
  const rows = React.useMemo(() => (c?.diff && !c.diff.loading ? computeRows(c.diff.oldText, c.diff.newText, 'none') : []), [c])
  if (!c) return null
  return (
    <div className="dig-theme dig-diffarea" data-theme={theme} style={{ bottom }}>
      <div className="dig-diff__head">
        <Icon name="diff" size={15} />
        <span className="dig-diff__title">{t('Compare')}: {c.from} ↔ {c.to}</span>
        <span style={{ flex: 1 }} />
        <span className="dig-diff__hint">{t('{n} files', { n: c.files.length })}</span>
        <IconButton icon="close" title={t('Close')} onClick={() => store.closeCompare()} />
      </div>
      <div className="dig-compare">
        <div className="dig-compare__files">
          {c.files.length === 0 && !c.loading ? <div className="dig-empty">{t('No differences')}</div> : null}
          {c.files.map((f) => {
            const color = f.kind === 'added' ? 'var(--vcs-added)' : f.kind === 'deleted' ? 'var(--vcs-deleted)' : 'var(--vcs-modified)'
            const letter = f.kind === 'added' ? 'A' : f.kind === 'deleted' ? 'D' : f.kind === 'renamed' ? 'R' : 'M'
            return (
              <div key={f.path} className="dig-compare__file" data-selected={c.sel === f.path ? 'true' : undefined} onClick={() => void store.selectCompareFile(f.path)} title={f.path}>
                <span style={{ color, width: 12, flex: 'none', fontFamily: 'var(--font-mono)' }}>{letter}</span>
                <span className="dig-compare__fname">{f.path.split('/').pop()}</span>
                <span className="dig-compare__fdir">{f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''}</span>
              </div>
            )
          })}
        </div>
        <div className="dig-compare__diff">
          {c.loading ? <div className="dig-empty">{t('Loading')}</div> : !c.diff ? <div className="dig-empty">{t('Select a file')}</div> : c.diff.loading ? <div className="dig-empty">{t('Loading')}</div> : (
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
    </div>
  )
}
