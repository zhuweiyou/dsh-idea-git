/** Changes & Commit view: a staged/unstaged file tree plus the commit message panel. */
import React from 'react'
import { useGit, Icon, IconButton, Button, Checkbox, Dropdown, MenuItem, baseName, dirName, kindColor, kindLetter, fileIconColor } from '../lib/ui'
import { useT, getActiveLocale } from '../lib/i18n'
import { openContextMenu, copyText } from '../lib/contextMenu'
import * as store from '../store'
import type { FileEntry } from '../types'

interface TreeNode {
  name: string
  path: string
  dir: boolean
  children?: TreeNode[]
  file?: FileEntry
}

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', dir: true, children: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let cur = root
    for (let i = 0; i < parts.length; i++) {
      const isLeaf = i === parts.length - 1
      const name = parts[i]
      const p = parts.slice(0, i + 1).join('/')
      cur.children = cur.children || []
      let next = cur.children.find((c) => c.name === name && c.dir === !isLeaf)
      if (!next) {
        next = isLeaf ? { name, path: p, dir: false, file } : { name, path: p, dir: true, children: [] }
        cur.children.push(next)
      }
      cur = next
    }
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    nodes.forEach((n) => n.children && sort(n.children))
  }
  sort(root.children!)
  return root.children!
}

function fileMenuItems(file: FileEntry, root: string, t: (x: string, p?: any) => string) {
  const path = file.path
  const canStage = file.unstaged || (!file.staged && file.kind !== 'conflicted')
  const canUnstage = file.staged
  const showDiff = () => void store.openDiff({ title: path, path, staged: file.staged && !file.unstaged })
  return [
    ...(file.kind === 'conflicted' ? [{ label: t('Resolve Conflicts…'), run: () => void store.openConflict(file.path) }] : []),
    { label: t('Show Diff'), run: showDiff },
    { label: t('Jump to Source'), run: showDiff },
    { separator: true },
    { label: t('Rollback…'), danger: true, run: () => { if (window.confirm(t('Discard changes to {path}? This cannot be undone.', { path }))) void store.discard([path]) } },
    { label: t('Stage'), disabled: !canStage, run: () => void store.stage([path]) },
    { label: t('Unstage'), disabled: !canUnstage, run: () => void store.unstage([path]) },
    ...(file.kind === 'untracked' ? [{ label: t('Add to .gitignore'), run: () => void store.addIgnore([path], 'gitignore') }] : []),
    { separator: true },
    { label: t('Create Patch…'), run: () => void store.createPatch({ paths: [path] }) },
    { label: t('Show History'), run: () => store.openHistory(path) },
    { label: t('Annotate with Git Blame'), run: () => void store.openBlame(path, path) },
    { separator: true },
    { label: t('Copy Path'), run: () => copyText(root ? root + '/' + path : path) },
    { label: t('Copy Relative Path'), run: () => copyText(path) },
  ]
}

function dirMenuItems(node: { path: string }, gs: any, t: (x: string, p?: any) => string) {
  const root = gs.info?.root || ''
  const files = (gs.files as FileEntry[]).filter((f) => f.path === node.path || f.path.startsWith(node.path + '/'))
  const paths = files.map((f) => f.path)
  return [
    { label: t('Show History'), disabled: true },
    { separator: true },
    { label: t('Rollback…'), danger: true, disabled: !files.length, run: () => { if (window.confirm(t('Discard changes to {path}? This cannot be undone.', { path: node.path }))) void store.discard(paths) } },
    { label: t('Stage'), disabled: !files.some((f) => f.unstaged || !f.staged), run: () => void store.stage(files.filter((f) => f.unstaged || !f.staged).map((f) => f.path)) },
    { label: t('Unstage'), disabled: !files.some((f) => f.staged), run: () => void store.unstage(files.filter((f) => f.staged).map((f) => f.path)) },
    { separator: true },
    { label: t('Copy Path'), run: () => copyText(root ? root + '/' + node.path : node.path) },
    { label: t('Copy Relative Path'), run: () => copyText(node.path) },
  ]
}

function FileRow({ file }: { file: FileEntry }) {
  const t = useT()
  const gs = useGit()
  const root = gs.info?.root || ''
  const canStage = file.unstaged || (!file.staged && file.kind !== 'conflicted')
  const canUnstage = file.staged
  const included = gs.include[file.path] !== false
  return (
    <div className="dig-filerow" title={file.path}
      onClick={() => store.openDiff({ title: file.path, path: file.path, staged: file.staged && !file.unstaged })}
      onContextMenu={(e) => openContextMenu(e, fileMenuItems(file, root, t))}>
      <span className="dig-check__box" data-on={included ? 'true' : undefined} style={{ flex: 'none', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); store.toggleInclude(file.path) }}>{included ? <Icon name="check" size={10} /> : null}</span>
      <span className="dig-filerow__icon" style={{ color: fileIconColor(file.path) }}>
        <Icon name="file" size={18} />
      </span>
      <span className="dig-filerow__name" style={{ color: file.kind === 'deleted' ? 'var(--vcs-deleted)' : undefined }}>
        {baseName(file.path)}
      </span>
      {dirName(file.path) ? <span className="dig-filerow__dir">{dirName(file.path)}</span> : null}
      <span className="dig-filerow__letter" style={{ color: kindColor(file.kind) }}>{kindLetter(file.kind)}</span>
      <span className="dig-filerow__actions" onClick={(e) => e.stopPropagation()}>
        {canStage ? <IconButton icon="plus" title={t('Stage')} size={13} onClick={() => store.stage([file.path])} /> : null}
        {canUnstage ? <IconButton icon="minus" title={t('Unstage')} size={13} onClick={() => store.unstage([file.path])} /> : null}
        {file.kind === 'conflicted' ? (
          <>
            <button type="button" className="dig-mini" title={t('Accept Ours')} onClick={() => void store.resolveConflict(file.path, 'ours')}>{t('Ours')}</button>
            <button type="button" className="dig-mini" title={t('Accept Theirs')} onClick={() => void store.resolveConflict(file.path, 'theirs')}>{t('Theirs')}</button>
          </>
        ) : null}
        {file.kind !== 'conflicted' ? (
          <IconButton
            icon="undo"
            title={t('Discard Changes')}
            size={13}
            onClick={() => {
              if (window.confirm(t('Discard changes to {path}? This cannot be undone.', { path: file.path }))) void store.discard([file.path])
            }}
          />
        ) : null}
      </span>
    </div>
  )
}

function TreeView({ nodes, depth, expanded, toggle }: { nodes: TreeNode[]; depth: number; expanded: Set<string>; toggle: (p: string) => void }) {
  const gs = useGit()
  const t = useT()
  const root = gs.info?.root || ''
  return (
    <>
      {nodes.map((n) => {
        if (n.dir) {
          const open = expanded.has(n.path)
          return (
            <React.Fragment key={'d:' + n.path}>
              <div className="dig-dirrow" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => toggle(n.path)}
                onContextMenu={(e) => openContextMenu(e, dirMenuItems(n, gs, t))}>
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
                <Icon name="folder" size={13} style={{ color: 'var(--fg-subtle)' }} />
                <span>{n.name}</span>
              </div>
              {open && n.children ? <TreeView nodes={n.children} depth={depth + 1} expanded={expanded} toggle={toggle} /> : null}
            </React.Fragment>
          )
        }
        return (
          <div key={'f:' + n.path} style={{ paddingLeft: depth * 14 }}>
            <FileRow file={n.file!} />
          </div>
        )
      })}
    </>
  )
}

function Group({ title, files, groupByDir }: { title: string; files: FileEntry[]; groupByDir: boolean }) {
  const gs = useGit()
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set<string>())
  const allOn = files.length > 0 && files.every((f) => gs.include[f.path] !== false)
  const tree = React.useMemo(() => buildTree(files), [files])
  React.useEffect(() => {
    const all = new Set<string>()
    const walk = (nodes: TreeNode[]) => nodes.forEach((n) => { if (n.dir) { all.add(n.path); walk(n.children || []) } })
    walk(tree)
    setExpanded((prev) => (prev.size === 0 ? all : prev))
  }, [tree])
  const toggle = (p: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(p)) next.delete(p); else next.add(p)
    return next
  })
  return (
    <div className="dig-group">
      <div className="dig-group__head">
        <span className="dig-check__box" data-on={allOn ? 'true' : undefined} style={{ flex: 'none', cursor: 'pointer' }} onClick={() => store.setIncludeAll(files.map((f) => f.path), !allOn)}>{allOn ? <Icon name="check" size={10} /> : null}</span>
        <span className="dig-group__title">{title}</span>
        <span className="dig-group__count">{files.length}</span>
      </div>
      {groupByDir ? <TreeView nodes={tree} depth={0} expanded={expanded} toggle={toggle} /> : files.slice().sort((a, b) => a.path.localeCompare(b.path)).map((f) => <div key={f.path} style={{ paddingLeft: 8 }}><FileRow file={f} /></div>)}
    </div>
  )
}

function CommitHistory({ onPick, t }: { onPick: (m: string) => void; t: (x: string, p?: any) => string }) {
  const [items] = React.useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('dig.msgHistory') || '[]') } catch { return [] } })
  return (
    <Dropdown align="right" trigger={() => <span className="dig-iconbtn" title={t('Commit Message History')} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon name="history" size={14} /></span>}>
      {(close) => items.length ? (
        <>{items.map((m, i) => <MenuItem key={i} onClick={() => { close(); onPick(m) }}>{m.split('\n')[0].slice(0, 90)}</MenuItem>)}</>
      ) : (<MenuItem disabled>{t('No history')}</MenuItem>)}
    </Dropdown>
  )
}

function CommitPanel() {
  const s = useGit()
  const t = useT()
  const includedCount = s.files.filter((f) => s.include[f.path] !== false).length
  const canCommit = includedCount > 0 || s.amend
  const firstLine = s.message.split('\n')[0] || ''
  return (
    <div className="dig-commit">
      <div className="dig-commit__bar">
        <Checkbox checked={s.amend} onChange={store.setAmend} label={t('Amend')} />
        <IconButton icon="sparkle" title={t('Generate commit message')} size={14} disabled={s.aiBusy} onClick={() => store.generateCommitMessage(getActiveLocale())} />
        <CommitHistory onPick={(m) => store.setMessage(m)} t={t} />
        <span style={{ flex: 1 }} />
        <span className="dig-commit__len">{firstLine.length}</span>
      </div>
      <textarea
        className="dig-commit__message"
        placeholder={t('Commit Message')}
        value={s.message}
        spellCheck
        onChange={(e) => store.setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            if (canCommit) void store.commitNow(e.altKey)
          }
        }}
      />
      <div className="dig-commit__actions">
        <Button primary disabled={!canCommit || s.busy} onClick={() => void store.commitNow(false)} title="⌘↵">{t('Commit')}{includedCount ? ` (${includedCount})` : ''}</Button>
        <Button disabled={!canCommit || s.busy} onClick={() => void store.commitNow(true)} title="⌥⌘↵">{t('Commit and Push')}</Button>
        <span style={{ flex: 1 }} />
        {s.busy ? <span className="dig-commit__busy">{t(s.busyLabel || 'Loading')}</span> : null}
      </div>
    </div>
  )
}

export function ChangesView() {
  const s = useGit()
  const t = useT()
  const [groupByDir, setGroupByDir] = React.useState<boolean>(() => localStorage.getItem('dig.groupByDir') !== '0')
  const [commitHeight, setCommitHeight] = React.useState(() => Number(localStorage.getItem('dig.commitHeight')) || 230)
  const heightRef = React.useRef(commitHeight)
  heightRef.current = commitHeight
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = heightRef.current
    const move = (ev: PointerEvent) => setCommitHeight(Math.max(120, Math.min(window.innerHeight - 200, startH + (startY - ev.clientY))))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      localStorage.setItem('dig.commitHeight', String(heightRef.current))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const staged = s.files.filter((f) => f.staged)
  const unstaged = s.files.filter((f) => !f.staged)
  const tree = (
    <div className="dig-changes">
      <div className="dig-toolbar">
        <IconButton icon="refresh" title={t('Refresh')} onClick={() => void store.refreshStatus()} />
        <IconButton icon="plus" title={t('Stage All')} onClick={() => void store.stageAll()} />
        <IconButton icon="minus" title={t('Unstage All')} onClick={() => void store.unstage(s.files.filter((f) => f.staged).map((f) => f.path))} />
        <span className="dig-toolbar__sep" />
        <IconButton icon="undo" title={t('Rollback All')} disabled={s.files.length === 0} onClick={() => { if (window.confirm(t('Rollback all changes? This cannot be undone.'))) void store.discard(s.files.map((f) => f.path)) }} />
        <IconButton icon="download" title={t('Update')} onClick={() => void store.remoteOp('pull')} />
        <Dropdown align="right" trigger={() => <span className="dig-iconbtn" title={t('View Options')} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon name="eye" size={14} /></span>}>
          {(close) => (<MenuItem checked={groupByDir} onClick={() => { close(); const v = !groupByDir; setGroupByDir(v); localStorage.setItem('dig.groupByDir', v ? '1' : '0') }}>{t('Group by Directory')}</MenuItem>)}
        </Dropdown>
        <span className="dig-toolbar__sep" />
        <span className="dig-toolbar__hint">{t('{n} changes', { n: s.files.length })}</span>
      </div>
      <div className="dig-treewrap">
        {s.files.length === 0 ? (
          <div className="dig-empty">{t('No local changes')}</div>
        ) : (
          <>
            {staged.length ? <Group title={t('Staged')} files={staged} groupByDir={groupByDir} /> : null}
            {unstaged.length ? <Group title={t('Changes')} files={unstaged} groupByDir={groupByDir} /> : null}
          </>
        )}
      </div>
    </div>
  )
  return (
    <div className="dig-vlayout">
      <div className="dig-vlayout__main" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{tree}</div>
      <div className="dig-vlayout__handle" role="separator" onPointerDown={startDrag} />
      <div style={{ flex: 'none', height: commitHeight, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <CommitPanel />
      </div>
    </div>
  )
}
