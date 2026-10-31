/** Log view aligned with OpenIDEA: branch tree, filter bar, commit graph list, details file tree. */
import React from 'react'
import { useGit, Icon, IconButton, Dropdown, MenuItem, formatDate } from '../lib/ui'
import { useT } from '../lib/i18n'
import { openContextMenu, copyText } from '../lib/contextMenu'
import { askText } from '../lib/prompt'
import { SplitPane } from '../lib/Split'
import { computeGraph, emptyGraphState, laneColor, type GraphRow } from '../lib/graph'
import * as store from '../store'
import type { BranchItem, CommitItem, FileEntry } from '../types'

const ROW = 26
const LANE = 14

function GraphCell({ row }: { row: GraphRow }) {
  const width = Math.max(1, row.width) * LANE + 8
  const x = (i: number) => 6 + i * LANE
  const y = ROW / 2
  const seg = (from: number, to: number, y1: number, y2: number, color: string, key: string) => {
    const mid = (y1 + y2) / 2
    const d = from === to ? `M ${x(from)} ${y1} L ${x(to)} ${y2}` : `M ${x(from)} ${y1} C ${x(from)} ${mid}, ${x(to)} ${mid}, ${x(to)} ${y2}`
    return <path key={key} d={d} stroke={color} strokeWidth={1.6} fill="none" />
  }
  return (
    <svg className="dig-crow__graph" width={width} height={ROW} aria-hidden="true">
      {row.up.map((s, i) => seg(s.from, s.to, 0, y, laneColor(s.color), 'u' + i))}
      {row.down.map((s, i) => seg(s.from, s.to, y, ROW, laneColor(s.color), 'd' + i))}
      <circle cx={x(row.lane)} cy={y} r={3.2} fill={laneColor(row.color)} />
    </svg>
  )
}

function RefLabel({ name }: { name: string }) {
  const kind = name.startsWith('tag:') ? 'tag' : /HEAD|^main$|^master$/.test(name) ? 'head' : /origin\/|upstream\//.test(name) ? 'remote' : ''
  const label = name.replace(/^tag:\s*/, '')
  return <span className={'dig-ref' + (kind ? ' dig-ref--' + kind : '')} title={name}>{label}</span>
}

/* -------------------- branch tree -------------------- */
interface BNode { name: string; path: string; dir: boolean; branch?: BranchItem; children?: BNode[] }

function buildBranchTree(branches: BranchItem[], prefix = ''): BNode[] {
  const dirs = new Map<string, BranchItem[]>()
  const leaves: BNode[] = []
  for (const b of branches) {
    const rest = prefix ? b.name.slice(prefix.length + 1) : b.name
    const slash = rest.indexOf('/')
    if (slash < 0) leaves.push({ name: rest, path: b.name, dir: false, branch: b })
    else {
      const head = rest.slice(0, slash)
      if (!dirs.has(head)) dirs.set(head, [])
      dirs.get(head)!.push(b)
    }
  }
  const nodes: BNode[] = []
  for (const [head, list] of dirs) {
    const path = prefix ? prefix + '/' + head : head
    nodes.push({ name: head, path, dir: true, children: buildBranchTree(list, path) })
  }
  return [...nodes, ...leaves]
}

function BranchRow({ b, t }: { b: BranchItem; t: (s: string, p?: any) => string }) {
  return (
    <div
      key={b.ref}
      className="dig-branchrow"
      data-current={b.current ? 'true' : undefined}
      title={b.name}
      onClick={(e) => {
        for (const el of Array.from(document.querySelectorAll('.dig-branchrow[data-selected]'))) el.removeAttribute('data-selected')
        ;(e.currentTarget as HTMLElement).setAttribute('data-selected', 'true')
      }}
      onContextMenu={(e) => openContextMenu(e, branchMenuItems(b, t))}
    >
      <Icon name="branch" size={15} style={{ color: b.current ? 'var(--warning)' : 'var(--fg-subtle)' }} />
      <span className="dig-branchrow__name">{b.name}</span>
      {b.ahead || b.behind ? <span className="dig-branchrow__sync">{b.ahead ? `↑${b.ahead}` : ''}{b.behind ? `↓${b.behind}` : ''}</span> : null}
    </div>
  )
}

function BranchNodes({ nodes, depth, expanded, toggle, t }: { nodes: BNode[]; depth: number; expanded: Set<string>; toggle: (p: string) => void; t: (s: string, p?: any) => string }) {
  return (
    <>
      {nodes.map((n) => {
        if (n.dir) {
          const open = expanded.has(n.path)
          return (
            <React.Fragment key={'d:' + n.path}>
              <div className="dig-branches__folder" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => toggle(n.path)}>
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
                <span>{n.name}</span>
              </div>
              {open && n.children ? <BranchNodes nodes={n.children} depth={depth + 1} expanded={expanded} toggle={toggle} t={t} /> : null}
            </React.Fragment>
          )
        }
        return <div key={'b:' + n.path} style={{ paddingLeft: depth * 14 + 8 }}>{n.branch ? <BranchRow b={n.branch} t={t} /> : null}</div>
      })}
    </>
  )
}

function BranchesPanel() {
  const s = useGit()
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set())
  const q = query.trim().toLowerCase()
  const match = (b: BranchItem) => !q || b.name.toLowerCase().includes(q)
  const locals = s.branches.filter((b) => !b.remote)
  const remotes = s.branches.filter((b) => b.remote && match(b))
  const localTree = React.useMemo(() => buildBranchTree(locals.filter(match)), [s.branches, q])
  const expanded = React.useMemo(() => {
    const all = new Set<string>()
    const walk = (ns: BNode[]) => ns.forEach((n) => { if (n.dir) { all.add(n.path); walk(n.children || []) } })
    walk(localTree)
    for (const k of collapsed) all.delete(k)
    return all
  }, [localTree, collapsed])
  const toggle = (p: string) => setCollapsed((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n })
  // remote groups: remote name -> branches with the remote prefix stripped
  const remoteGroups = React.useMemo(() => {
    const g = new Map<string, BranchItem[]>()
    for (const b of remotes) {
      const [remoteName, ...rest] = b.name.split('/')
      const short = rest.join('/') || b.name
      if (!g.has(remoteName)) g.set(remoteName, [])
      g.get(remoteName)!.push({ ...b, name: short })
    }
    return g
  }, [remotes])
  const current = locals.find((b) => b.current)
  return (
    <div className="dig-branches">
      <div className="dig-branches__search">
        <Icon name="search" size={13} style={{ color: 'var(--fg-subtle)' }} />
        <input className="dig-branches__input" placeholder={t('Branch or tag')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="dig-branches__list">
        <div className="dig-branches__section"><Icon name="folder" size={15} /><span>{t('Local')}</span><span style={{ flex: 1 }} /><IconButton icon="refresh" title={t('Refresh')} size={13} onClick={() => void store.refreshAll()} /></div>
        {current ? <div style={{ paddingLeft: 8 }}><BranchRow b={current} t={t} /></div> : null}
        <BranchNodes nodes={localTree} depth={1} expanded={expanded} toggle={toggle} t={t} />
        {remoteGroups.size ? <div className="dig-branches__section" style={{ marginTop: 4 }}><Icon name="cloud" size={15} /><span>{t('Remote')}</span></div> : null}
        {[...remoteGroups.entries()].map(([remote, list]) => (
          <div key={remote}>
            <div className="dig-branches__folder" style={{ paddingLeft: 8 }} onClick={() => toggle('remote:' + remote)}>
              <Icon name={(collapsed.has('remote:' + remote)) ? 'chevronRight' : 'chevronDown'} size={12} />
              <span>{remote}</span>
            </div>
            {!collapsed.has('remote:' + remote) ? list.map((b) => <div key={b.ref} style={{ paddingLeft: 22 }}><BranchRow b={b} t={t} /></div>) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

/* -------------------- details: file tree -------------------- */
interface FNode { name: string; path: string; dir: boolean; children?: FNode[]; file?: FileEntry; count: number }

function buildFileTree(files: FileEntry[]): FNode[] {
  const root: FNode = { name: '', path: '', dir: true, children: [], count: 0 }
  for (const file of files) {
    const parts = file.path.split('/')
    let cur = root
    for (let i = 0; i < parts.length; i++) {
      const leaf = i === parts.length - 1
      cur.children = cur.children || []
      let next = cur.children.find((c) => c.name === parts[i] && c.dir === !leaf)
      if (!next) {
        next = leaf ? { name: parts[i], path: file.path, dir: false, file, count: 1 } : { name: parts[i], path: parts.slice(0, i + 1).join('/'), dir: true, children: [], count: 0 }
        cur.children.push(next)
      }
      cur = next
    }
  }
  const finalize = (n: FNode) => {
    if (n.children) { n.children.forEach(finalize); n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1)) }
    n.count = n.children ? n.children.reduce((a, c) => a + (c.dir ? c.count : 1), 0) : 1
  }
  finalize(root)
  return root.children || []
}

function FileNodes({ nodes, depth, expanded, toggle, commit, shortId, t }: { nodes: FNode[]; depth: number; expanded: Set<string>; toggle: (p: string) => void; commit: string; shortId: string; t: (s: string, p?: any) => string }) {
  return (
    <>
      {nodes.map((n) => {
        if (n.dir) {
          const open = expanded.has(n.path)
          return (
            <React.Fragment key={'d:' + n.path}>
              <div className="dig-dfile-dir" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => toggle(n.path)}>
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
                <Icon name="folder" size={15} style={{ color: 'var(--fg-subtle)' }} />
                <span>{n.name}</span>
                <span className="dig-dfile-count">{n.count}</span>
              </div>
              {open && n.children ? <FileNodes nodes={n.children} depth={depth + 1} expanded={expanded} toggle={toggle} commit={commit} shortId={shortId} t={t} /> : null}
            </React.Fragment>
          )
        }
        const f = n.file!
        const letter = f.kind === 'added' ? 'A' : f.kind === 'deleted' ? 'D' : f.kind === 'renamed' ? 'R' : 'M'
        const color = f.kind === 'added' ? 'var(--vcs-added)' : f.kind === 'deleted' ? 'var(--vcs-deleted)' : 'var(--vcs-modified)'
        return (
          <div key={'f:' + n.path} className="dig-dfile" style={{ paddingLeft: 22 + depth * 14 }} title={f.path}
            onClick={() => void store.openDiff({ title: shortId + ': ' + f.path, commit, path: f.path })}
            onContextMenu={(e) => openContextMenu(e, [
              { label: t('Show Diff'), run: () => void store.openDiff({ title: shortId + ': ' + f.path, commit, path: f.path }) },
              { label: t('Show History'), run: () => store.openHistory(f.path) },
              { label: t('Annotate with Git Blame'), run: () => void store.openBlame(f.path, f.path) },
              { separator: true },
              { label: t('Copy Path'), run: () => copyText(f.path) },
              { label: t('Copy Relative Path'), run: () => copyText(f.path) },
            ])}>
            <span className="dig-dfile__letter" style={{ color }}>{letter}</span>
            <span className="dig-dfile__name">{n.name}</span>
          </div>
        )
      })}
    </>
  )
}

function DetailsPane() {
  const s = useGit()
  const t = useT()
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const commit = s.commits.find((c) => c.id === s.selectedCommit)
  const tree = React.useMemo(() => buildFileTree(s.commitFiles), [s.commitFiles])
  React.useEffect(() => {
    const all = new Set<string>()
    const walk = (ns: FNode[]) => ns.forEach((n) => { if (n.dir) { all.add(n.path); walk(n.children || []) } })
    walk(tree); setExpanded(all)
  }, [tree])
  if (!commit) return <div className="dig-details"><div className="dig-empty">{t('Select a commit to see details')}</div></div>
  const toggle = (p: string) => setExpanded((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n })
  return (
    <div className="dig-details">
      <div className="dig-details__fileshead">{t('{n} files', { n: s.commitFiles.length })}</div>
      <div className="dig-details__files">
        <FileNodes nodes={tree} depth={0} expanded={expanded} toggle={toggle} commit={commit.id} shortId={commit.shortId} t={t} />
      </div>
      <div className="dig-details__msg">
        <div className="dig-details__subject">{commit.subject}</div>
        {commit.message && commit.message !== commit.subject ? <div className="dig-details__body">{commit.message.slice(commit.subject.length).trim()}</div> : null}
        <div className="dig-details__meta"><span className="dig-details__hash">{commit.shortId}</span> {commit.author} &lt;{commit.authorEmail}&gt; · {formatDate(commit.committerDate)}</div>
      </div>
    </div>
  )
}

/* -------------------- filter bar + list -------------------- */
/* -------------------- context menus (ported from OpenIDEA) -------------------- */
function commitMenuItems(c: CommitItem, selection: CommitItem[], t: (x: string, p?: any) => string) {
  const multi = selection.length > 1
  if (multi) {
    return [
      { label: t('Copy Revision Numbers'), run: () => copyText(selection.map((x) => x.id).join('\n')) },
      { label: t('Cherry-Pick'), run: () => void store.cherryPick(selection.map((x) => x.id)) },
      { separator: true },
      { label: t('Revert Commits'), disabled: true },
      { label: t('Squash Commits'), disabled: true },
      { label: t('Drop Commits'), disabled: true },
    ]
  }
  return [
    { label: t('Copy Revision Number'), run: () => copyText(c.id) },
    { label: t('Copy Commit Message'), run: () => copyText(c.message || c.subject) },
    { separator: true },
    { label: t('Checkout Revision'), run: () => void store.checkout(c.id) },
    { separator: true },
    { label: t('Reset Current Branch to Here (Soft)'), run: () => { if (window.confirm(t('Reset to this commit (soft)?'))) void store.resetTo(c.id, 'soft') } },
    { label: t('Revert Commit'), run: () => { if (window.confirm(t('Revert this commit?'))) void store.revertCommit(c.id) } },
    { separator: true },
    { label: t('New Branch from Here…'), run: async () => { const n = await askText(t('New branch name')); if (n) void store.createBranchAt(n, c.id) } },
    { label: t('New Tag Here…'), run: async () => { const n = await askText(t('New tag name')); if (n) void store.createTag(n, c.id) } },
    { separator: true },
    { label: t('Cherry-Pick'), run: () => void store.cherryPick([c.id]) },
  ]
}

function branchMenuItems(b: BranchItem, t: (x: string, p?: any) => string) {
  if (b.current) {
    return [
      { label: t("New Branch from '{name}'…", { name: b.name }), run: async () => { const n = await askText(t('New branch name')); if (n) void store.createBranchAt(n, b.name) } },
      { separator: true },
      { label: t('Update'), run: () => void store.remoteOp('pull') },
      { label: t('Push…'), run: () => void store.remoteOp('push') },
      { separator: true },
      { label: t('Rename…'), run: async () => { const n = await askText(t('New branch name'), b.name); if (n && n !== b.name) void store.renameBranch(b.name, n) } },
      { label: t('Show History'), run: () => store.openBranchHistory(b.name) },
    ]
  }
  return [
    { label: t('Checkout'), run: () => void store.checkout(b.name) },
    { label: t("New Branch from '{name}'…", { name: b.name }), run: async () => { const n = await askText(t('New branch name')); if (n) void store.createBranchAt(n, b.name) } },
    { separator: true },
    { label: t('Show History'), run: () => store.openBranchHistory(b.name) },
    { label: t('Copy Branch Name'), run: () => copyText(b.name) },
    { separator: true },
    { label: t("Merge '{name}' into Current", { name: b.name }), disabled: b.remote, run: () => { if (window.confirm(t('Merge {name} into current branch?', { name: b.name }))) void store.mergeBranch(b.name) } },
    ...(b.remote ? [] : [
      { separator: true },
      { label: t('Rename…'), run: async () => { const n = await askText(t('New branch name'), b.name); if (n && n !== b.name) void store.renameBranch(b.name, n) } },
      { label: t('Delete'), danger: true, run: () => { if (window.confirm(t('Delete branch {name}?', { name: b.name }))) void store.deleteBranch(b.name) } },
    ]),
  ]
}

function CommitRow({ commit, row, selected, selection }: { commit: CommitItem; row: GraphRow; selected: boolean; selection: CommitItem[] }) {
  const t = useT()
  return (
    <div className="dig-crow" data-selected={selected ? 'true' : undefined} onClick={(e) => void store.selectCommit(commit.id, e.shiftKey ? 'range' : (e.metaKey || e.ctrlKey) ? 'toggle' : 'single')} title={commit.subject}
      onContextMenu={(e) => openContextMenu(e, commitMenuItems(commit, selection, t))}>
      <GraphCell row={row} />
      <span className="dig-crow__subject">
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{commit.subject}</span>
        {commit.refs.length ? <span className="dig-refs">{commit.refs.map((r) => <RefLabel key={r} name={r} />)}</span> : null}
      </span>
      <span className="dig-crow__author">{commit.author}</span>
      <span className="dig-crow__date">{formatDate(commit.authorDate)}</span>
    </div>
  )
}

function CommitList({ text, regex, caseSensitive, author, dateDays }: { text: string; regex: boolean; caseSensitive: boolean; author: string | null; dateDays: number | null }) {
  const s = useGit()
  const t = useT()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const filtered = React.useMemo(() => {
    let list = s.commits
    const q = text.trim()
    if (q) {
      let re: RegExp | null = null
      if (regex) { try { re = new RegExp(q, caseSensitive ? '' : 'i') } catch { re = null } }
      list = list.filter((c) => {
        const hay = [c.subject, c.author, c.shortId, c.refs.join(' ')].join(' ')
        if (re) return re.test(hay)
        return caseSensitive ? hay.includes(q) : hay.toLowerCase().includes(q.toLowerCase())
      })
    }
    if (author) list = list.filter((c) => c.author === author)
    if (dateDays != null) { const cut = Date.now() - dateDays * 86400000; list = list.filter((c) => c.committerDate >= cut) }
    return list
  }, [s.commits, text, regex, caseSensitive, author, dateDays])
  const rows = React.useMemo(() => {
    if (!filtered.length) return [] as GraphRow[]
    return computeGraph(filtered.map((c) => ({ id: c.id, parents: c.parents })), emptyGraphState()).rows
  }, [filtered])
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => { if (s.logHasMore && !s.logLoading && el.scrollTop + el.clientHeight >= el.scrollHeight - 200) void store.loadLog(false) }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [s.logHasMore, s.logLoading])
  return (
    <div className="dig-commitlist" ref={scrollRef}>
      {filtered.length === 0 ? <div className="dig-empty">{s.logLoading ? t('Loading') : t('No commits')}</div> : null}
      {filtered.map((c, i) => <CommitRow key={c.id} commit={c} row={rows[i]} selected={s.selectedCommit === c.id || s.selection.includes(c.id)} selection={s.selection.includes(c.id) ? s.commits.filter((x) => s.selection.includes(x.id)) : [c]} />)}
      {s.logLoading ? <div className="dig-empty">{t('Loading')}</div> : null}
    </div>
  )
}

function FilterBar({ text, setText, regex, setRegex, caseSensitive, setCase, author, setAuthor, dateDays, setDateDays }: { text: string; setText: (v: string) => void; regex: boolean; setRegex: (v: boolean) => void; caseSensitive: boolean; setCase: (v: boolean) => void; author: string | null; setAuthor: (v: string | null) => void; dateDays: number | null; setDateDays: (v: number | null) => void }) {
  const s = useGit()
  const t = useT()
  const authors = React.useMemo(() => [...new Set(s.commits.map((c) => c.author))].sort().slice(0, 40), [s.commits])
  const dateOpts: Array<{ v: number | null; label: string }> = [
    { v: null, label: t('All time') },
    { v: 1, label: t('Today') },
    { v: 7, label: t('Last 7 days') },
    { v: 30, label: t('Last 30 days') },
  ]
  return (
    <div className="dig-filterbar">
      <div className="dig-searchwrap">
        <Icon name="search" size={13} style={{ color: 'var(--fg-subtle)' }} />
        <input className="dig-search" placeholder={t('Text or hash')} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" className="dig-toggle" data-on={regex ? 'true' : undefined} title={t('Regex')} onClick={() => setRegex(!regex)}>.*</button>
        <button type="button" className="dig-toggle" data-on={caseSensitive ? 'true' : undefined} title={t('Case sensitive')} onClick={() => setCase(!caseSensitive)}>Cc</button>
      </div>
      {s.info?.branch?.head ? <span className="dig-chip dig-chip--static" title={s.info.branch.head}>{t('Branch')}: {s.info.branch.head}</span> : null}
      <Dropdown align="right" trigger={() => <span className="dig-filterbtn" data-active={author ? 'true' : undefined}>{author || t('User')} ▾</span>}>
        {(close) => (<>
          <MenuItem checked={!author} onClick={() => { close(); setAuthor(null) }}>{t('All users')}</MenuItem>
          {authors.map((a) => <MenuItem key={a} checked={author === a} onClick={() => { close(); setAuthor(a) }}>{a}</MenuItem>)}
        </>)}
      </Dropdown>
      <Dropdown align="right" trigger={() => <span className="dig-filterbtn" data-active={dateDays != null ? 'true' : undefined}>{dateDays != null ? (dateOpts.find((o) => o.v === dateDays)?.label || t('Date')) : t('Date')} ▾</span>}>
        {(close) => (<>{dateOpts.map((o) => <MenuItem key={String(o.v)} checked={dateDays === o.v} onClick={() => { close(); setDateDays(o.v) }}>{o.label}</MenuItem>)}</>)}
      </Dropdown>
      <span style={{ flex: 1 }} />
      <IconButton icon="refresh" title={t('Refresh log')} onClick={() => void store.loadLog(true)} />
    </div>
  )
}

export function LogView() {
  const s = useGit()
  const t = useT()
  const [showBranches] = React.useState(() => localStorage.getItem('dig.showBranches') !== '0')
  const [text, setText] = React.useState('')
  const [regex, setRegex] = React.useState(false)
  const [caseSensitive, setCase] = React.useState(false)
  const [author, setAuthor] = React.useState<string | null>(null)
  const [dateDays, setDateDays] = React.useState<number | null>(null)
  const center = (
    <div className="dig-log">
      <FilterBar text={text} setText={setText} regex={regex} setRegex={setRegex} caseSensitive={caseSensitive} setCase={setCase} author={author} setAuthor={setAuthor} dateDays={dateDays} setDateDays={setDateDays} />
      {s.logBranch ? (
        <div className="dig-historybar"><span className="dig-chip">{t('Branch')}: {s.logBranch}<button type="button" className="dig-chip__x" onClick={() => store.clearBranchHistory()}>✕</button></span></div>
      ) : null}
      {s.logFilterFile ? (
        <div className="dig-historybar">
          <span className="dig-chip">{t('History: {file}', { file: s.logFilterFile })}<button type="button" className="dig-chip__x" onClick={() => store.clearHistory()}>✕</button></span>
        </div>
      ) : null}
      <div className="dig-listhead">
        <span style={{ width: 70 }}>{t('Graph')}</span>
        <span style={{ flex: 1 }}>{t('Subject')}</span>
        <span style={{ width: 120 }}>{t('Author')}</span>
        <span style={{ width: 130 }}>{t('Date')}</span>
      </div>
      <CommitList text={text} regex={regex} caseSensitive={caseSensitive} author={author} dateDays={dateDays} />
    </div>
  )
  const right = <DetailsPane />
  if (!showBranches) return <div className="dig-hlayout">{center}</div>
  return (
    <div className="dig-hlayout">
      <SplitPane orientation="horizontal" first={<BranchesPanel />} second={<SplitPane orientation="horizontal" first={center} second={right} initial={Math.max(320, (typeof window !== 'undefined' ? window.innerWidth : 900) - 780)} min={240} storageKey="logDetails" />} initial={240} min={160} max={420} storageKey="branches" />
    </div>
  )
}
