/** Log view aligned with OpenIDEA: branch tree, filter bar, commit graph list, details file tree. */
import React from "react"
import { useGit, Icon, IconButton, Dropdown, MenuItem, formatDate } from "../lib/ui"
import { useT } from "../lib/i18n"
import { openContextMenu, copyText } from "../lib/contextMenu"
import { askText, askMultiline } from "../lib/prompt"
import { SplitPane } from "../lib/Split"
import { computeGraph, emptyGraphState, laneColor, type GraphRow } from "../lib/graph"
import * as store from "../store"
import { confirmThen } from "../lib/confirm"
import { chooseRef } from "../lib/refChooser"
import type { BranchItem, CommitItem, FileEntry } from "../types"

const ROW = 26
const LANE = 14

function GraphCell({ row }: { row: GraphRow }) {
  const width = Math.max(1, row.width) * LANE + 8
  const x = (i: number) => 6 + i * LANE
  const y = ROW / 2
  const seg = (from: number, to: number, y1: number, y2: number, color: string, key: string) => {
    const mid = (y1 + y2) / 2
    const d =
      from === to
        ? `M ${x(from)} ${y1} L ${x(to)} ${y2}`
        : `M ${x(from)} ${y1} C ${x(from)} ${mid}, ${x(to)} ${mid}, ${x(to)} ${y2}`
    return <path key={key} d={d} stroke={color} strokeWidth={1.6} fill="none" />
  }
  return (
    <svg className="dig-crow__graph" width={width} height={ROW} aria-hidden="true">
      {row.up.map((s, i) => seg(s.from, s.to, 0, y, laneColor(s.color), "u" + i))}
      {row.down.map((s, i) => seg(s.from, s.to, y, ROW, laneColor(s.color), "d" + i))}
      <circle cx={x(row.lane)} cy={y} r={3.2} fill={laneColor(row.color)} />
    </svg>
  )
}

function RefLabel({ name }: { name: string }) {
  const kind = name.startsWith("tag:")
    ? "tag"
    : /HEAD|^main$|^master$/.test(name)
      ? "head"
      : /origin\/|upstream\//.test(name)
        ? "remote"
        : ""
  const label = name.replace(/^tag:\s*/, "")
  return (
    <span className={"dig-ref" + (kind ? " dig-ref--" + kind : "")} title={name}>
      {label}
    </span>
  )
}

/* -------------------- branch tree -------------------- */
interface BNode {
  name: string
  path: string
  dir: boolean
  branch?: BranchItem
  children?: BNode[]
}

function buildBranchTree(branches: BranchItem[], prefix = "", favs: Set<string> = new Set()): BNode[] {
  const dirs = new Map<string, BranchItem[]>()
  const leaves: BNode[] = []
  for (const b of branches) {
    const rest = prefix ? b.name.slice(prefix.length + 1) : b.name
    const slash = rest.indexOf("/")
    if (slash < 0) leaves.push({ name: rest, path: b.name, dir: false, branch: b })
    else {
      const head = rest.slice(0, slash)
      if (!dirs.has(head)) dirs.set(head, [])
      dirs.get(head)!.push(b)
    }
  }
  const nodes: BNode[] = []
  for (const [head, list] of dirs) {
    const path = prefix ? prefix + "/" + head : head
    nodes.push({ name: head, path, dir: true, children: buildBranchTree(list, path, favs) })
  }
  const rank = (b: BranchItem) => (b.current ? 0 : favs.has(b.name) ? 1 : 2)
  const sorted = [...leaves].sort((a, b) => rank(a.branch!) - rank(b.branch!) || a.name.localeCompare(b.name))
  const top = sorted.filter((n) => rank(n.branch!) < 2)
  const rest = sorted.filter((n) => rank(n.branch!) === 2)
  return [...top, ...nodes, ...rest]
}

function TreeRow({
  depth,
  toggle,
  icon,
  label,
  trailing,
  title,
  className,
  onClick,
  onDoubleClick,
  onContextMenu,
  dataRef,
  dataCurrent,
  dataRemote,
}: {
  depth: number
  toggle?: React.ReactNode
  icon: React.ReactNode
  label: React.ReactNode
  trailing?: React.ReactNode
  title?: string
  className?: string
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  onDoubleClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void
  dataRef?: string
  dataCurrent?: boolean
  dataRemote?: boolean
}) {
  return (
    <div
      className={"dig-tree-row" + (className ? " " + className : "")}
      style={{ ["--tree-depth" as any]: depth }}
      title={title}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      data-ref={dataRef}
      data-current={dataCurrent ? "true" : undefined}
      data-remote={dataRemote ? "true" : undefined}
    >
      <span className="dig-tree-row__toggle">{toggle}</span>
      <span className="dig-tree-row__icon">{icon}</span>
      <span className="dig-tree-row__label">{label}</span>
      {trailing}
    </div>
  )
}

function BranchRow({
  b,
  t,
  label,
  depth = 0,
  onSelect,
}: {
  b: BranchItem
  t: (s: string, p?: any) => string
  label?: string
  depth?: number
  onSelect?: (name: string) => void
}) {
  return (
    <TreeRow
      depth={depth}
      className="dig-branchrow"
      dataRef={b.name}
      dataRemote={b.remote}
      dataCurrent={b.current}
      title={b.name}
      icon={
        <Icon
          name={isFavorite(b.name) ? "star" : "branch"}
          size={16}
          style={{ color: b.current ? "var(--warning)" : "var(--fg-subtle)" }}
        />
      }
      label={label ?? b.name}
      trailing={
        b.ahead || b.behind ? (
          <span className="dig-branchrow__sync">
            {b.ahead ? `↑${b.ahead}` : ""}
            {b.behind ? `↓${b.behind}` : ""}
          </span>
        ) : undefined
      }
      onClick={(e) => {
        onSelect?.(b.name)
        for (const el of Array.from(document.querySelectorAll(".dig-tree-row[data-selected]")))
          el.removeAttribute("data-selected")
        ;(e.currentTarget as HTMLElement).setAttribute("data-selected", "true")
      }}
      onDoubleClick={() => store.openBranchHistory(b.name)}
      onContextMenu={(e) => openContextMenu(e, branchMenuItems(b, t))}
    />
  )
}

function BranchNodes({
  nodes,
  depth,
  expanded,
  toggle,
  t,
  onSelect,
}: {
  nodes: BNode[]
  depth: number
  expanded: Set<string>
  toggle: (p: string) => void
  t: (s: string, p?: any) => string
  onSelect?: (name: string) => void
}) {
  return (
    <>
      {nodes.map((n) => {
        if (n.dir) {
          const open = expanded.has(n.path)
          return (
            <React.Fragment key={"d:" + n.path}>
              <TreeRow
                depth={depth}
                toggle={<Icon name={open ? "chevronDown" : "chevronRight"} size={14} />}
                icon={<Icon name="folder" size={16} style={{ color: "var(--fg-subtle)" }} />}
                label={n.name}
                onClick={() => toggle(n.path)}
              />
              {open && n.children ? (
                <BranchNodes
                  nodes={n.children}
                  depth={depth + 1}
                  expanded={expanded}
                  toggle={toggle}
                  t={t}
                  onSelect={onSelect}
                />
              ) : null}
            </React.Fragment>
          )
        }
        return <BranchRow key={"b:" + n.path} b={n.branch!} t={t} label={n.name} depth={depth} onSelect={onSelect} />
      })}
    </>
  )
}

const FAV_KEY = "dig.branchFavorites"
function favSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]"))
  } catch {
    return new Set()
  }
}
function isFavorite(name: string) {
  return favSet().has(name)
}
function toggleFavorite(name: string) {
  const s = favSet()
  if (s.has(name)) s.delete(name)
  else s.add(name)
  localStorage.setItem(FAV_KEY, JSON.stringify([...s]))
}

function BranchesPanel({ onHide }: { onHide: () => void }) {
  const s = useGit()
  const t = useT()
  const [favTick, setFavTick] = React.useState(0)
  React.useEffect(() => {}, [favTick])
  const [selectedName, setSelectedName] = React.useState("")
  const [query, setQuery] = React.useState("")
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set())
  const q = query.trim().toLowerCase()
  const match = (b: BranchItem) => !q || b.name.toLowerCase().includes(q)
  const locals = s.branches.filter((b) => !b.remote)
  const remotes = s.branches.filter((b) => b.remote && match(b))
  const localTree = React.useMemo(() => buildBranchTree(locals.filter(match), "", favSet()), [s.branches, q, favTick])
  // remote groups: remote name -> its branches (full names, e.g. origin/feature/x)
  const remoteGroups = React.useMemo(() => {
    const g = new Map<string, BranchItem[]>()
    for (const b of remotes) {
      const remoteName = b.name.split("/")[0]
      if (!g.has(remoteName)) g.set(remoteName, [])
      g.get(remoteName)!.push(b)
    }
    return g
  }, [remotes])
  const remoteTrees = React.useMemo(() => {
    const m = new Map<string, BNode[]>()
    for (const [remote, list] of remoteGroups) m.set(remote, buildBranchTree(list, remote, favSet()))
    return m
  }, [remoteGroups, favTick])
  const expanded = React.useMemo(() => {
    const all = new Set<string>()
    const walk = (ns: BNode[]) =>
      ns.forEach((n) => {
        if (n.dir) {
          all.add(n.path)
          walk(n.children || [])
        }
      })
    walk(localTree)
    for (const t of remoteTrees.values()) walk(t)
    for (const k of collapsed) all.delete(k)
    return all
  }, [localTree, remoteTrees, collapsed])
  const toggle = (p: string) =>
    setCollapsed((prev) => {
      const n = new Set(prev)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })
  const favBranches = s.branches.filter((b) => favSet().has(b.name))
  const selectedBranch = s.branches.find((b) => b.name === selectedName)
  const isRemoteRef = () => !!selectedBranch?.remote
  const refreshFav = () => setFavTick((x) => x + 1)
  return (
    <div className="dig-branches">
      <div className="dig-branches__rail" role="toolbar" aria-orientation="vertical" aria-label={t("Branches")}>
        <IconButton icon="chevronLeft" size={13} title={t("Hide Branches")} onClick={onHide} />
        <IconButton
          icon="plus"
          size={13}
          title={t("New Branch…")}
          onClick={async () => {
            const n = await askText(t("New branch name"))
            if (n) void store.createBranchAt(n, selectedName || "HEAD")
          }}
        />
        <IconButton
          icon="download"
          size={13}
          title={t("Update Selected")}
          onClick={() => void store.remoteOp("pull")}
        />
        <IconButton
          icon="trash"
          size={13}
          title={t("Delete Branch")}
          onClick={() => {
            const r = selectedName
            if (r && !isRemoteRef())
              confirmThen(t("Delete branch {name}?", { name: r }), () => {
                void store.deleteBranch(r)
              })
          }}
        />
        <IconButton
          icon="target"
          size={13}
          title={t("Navigate Log to Selected Branch")}
          onClick={() => {
            const r = selectedName
            if (r) store.openBranchHistory(r)
          }}
        />
        <IconButton
          icon={isFavorite(selectedName) ? "star" : "starOutline"}
          size={16}
          title={isFavorite(selectedName) ? t("Remove from Favorites") : t("Add to Favorites")}
          onClick={() => {
            const r = selectedName
            if (r) {
              const on = !isFavorite(r)
              toggleFavorite(r)
              refreshFav()
              store.setToast(on ? t("Added to Favorites") + ": " + r : t("Removed from Favorites") + ": " + r)
            }
          }}
        />
        <IconButton icon="cloud" size={13} title={t("Fetch")} onClick={() => void store.remoteOp("fetch")} />
        <IconButton icon="refresh" size={13} title={t("Refresh")} onClick={() => void store.refreshWithFeedback()} />
      </div>
      <div className="dig-branches__main">
        <div className="dig-branches__search">
          <Icon name="search" size={13} style={{ color: "var(--fg-subtle)" }} />
          <input
            className="dig-branches__input"
            placeholder={t("Branch or tag")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="dig-branches__list">
          {favBranches.length ? (
            <>
              <div className="dig-branches__section">
                <Icon name="star" size={15} />
                <span>{t("Favorites")}</span>
              </div>
              {favBranches.map((b) => (
                <BranchRow
                  key={"fav:" + b.ref}
                  b={b}
                  t={t}
                  label={b.name.split("/").pop()}
                  depth={0}
                  onSelect={setSelectedName}
                />
              ))}
            </>
          ) : null}
          <div className="dig-branches__section">
            <Icon name="folder" size={15} />
            <span>{t("Local")}</span>
            <span style={{ flex: 1 }} />
            <IconButton
              icon="refresh"
              title={t("Refresh")}
              size={13}
              onClick={async () => {
                await store.refreshAll()
                store.setToast(t("Refreshed"))
              }}
            />
          </div>
          <BranchNodes
            nodes={localTree}
            depth={0}
            expanded={expanded}
            toggle={toggle}
            t={t}
            onSelect={setSelectedName}
          />
          {remoteGroups.size ? (
            <div className="dig-branches__section" style={{ marginTop: 4 }}>
              <Icon name="cloud" size={15} />
              <span>{t("Remote")}</span>
              <span style={{ flex: 1 }} />
              <IconButton
                icon="plus"
                title={t("Add Remote…")}
                size={13}
                onClick={async () => {
                  const n = await askText(t("Remote name"))
                  if (!n) return
                  const u = await askText(t("Remote URL"))
                  if (u) void store.addRemote(n, u)
                }}
              />
            </div>
          ) : null}
          {[...remoteGroups.entries()].map(([remote]) => (
            <div key={remote}>
              <TreeRow
                depth={0}
                toggle={<Icon name={collapsed.has("remote:" + remote) ? "chevronRight" : "chevronDown"} size={14} />}
                icon={<Icon name="folder" size={16} style={{ color: "var(--fg-subtle)" }} />}
                label={remote}
                onClick={() => toggle("remote:" + remote)}
                onContextMenu={(e) => {
                  const url = s.remotes.find((r) => r.name === remote)?.url || ""
                  openContextMenu(e, [
                    {
                      label: t("Edit URL…"),
                      run: async () => {
                        const u = await askText(t("Remote URL"), url)
                        if (u) void store.setRemoteUrl(remote, u)
                      },
                    },
                    { separator: true },
                    {
                      label: t("Remove Remote"),
                      danger: true,
                      run: () => {
                        confirmThen(t("Remove remote {name}?", { name: remote }), () => {
                          void store.removeRemote(remote)
                        })
                      },
                    },
                  ])
                }}
              />
              {!collapsed.has("remote:" + remote) ? (
                <BranchNodes
                  nodes={remoteTrees.get(remote) || []}
                  depth={1}
                  expanded={expanded}
                  toggle={toggle}
                  t={t}
                  onSelect={setSelectedName}
                />
              ) : null}
            </div>
          ))}
          {s.tags.length ? (
            <div className="dig-branches__section" style={{ marginTop: 4 }}>
              <Icon name="tag" size={15} />
              <span>{t("Tags")}</span>
            </div>
          ) : null}
          {s.tags
            .filter((t) => !q || t.toLowerCase().includes(q))
            .map((tag) => (
              <TreeRow
                key={tag}
                depth={0}
                icon={<Icon name="tag" size={16} style={{ color: "var(--fg-subtle)" }} />}
                label={tag}
                title={tag}
                onClick={(e) => {
                  setSelectedName(tag)
                  for (const el of Array.from(document.querySelectorAll(".dig-tree-row[data-selected]")))
                    el.removeAttribute("data-selected")
                  ;(e.currentTarget as HTMLElement).setAttribute("data-selected", "true")
                }}
                onDoubleClick={() => store.openBranchHistory(tag)}
                onContextMenu={(e) =>
                  openContextMenu(e, [
                    { label: t("Checkout"), run: () => void store.checkout(tag) },
                    {
                      label: t("New Branch from Here…"),
                      run: async () => {
                        const n = await askText(t("New branch name"))
                        if (n) void store.createBranchAt(n, tag)
                      },
                    },
                    { label: t("Show History"), run: () => store.openBranchHistory(tag) },
                    { label: t("Copy Branch Name"), run: () => copyText(tag) },
                    { separator: true },
                    { label: t("Push Tag"), run: () => void store.pushTag(tag) },
                    {
                      label: t("Delete"),
                      danger: true,
                      run: () => {
                        confirmThen(t("Delete tag {name}?", { name: tag }), () => {
                          void store.deleteTag(tag)
                        })
                      },
                    },
                  ])
                }
              />
            ))}
        </div>
      </div>
    </div>
  )
}

/* -------------------- details: file tree -------------------- */
interface FNode {
  name: string
  path: string
  dir: boolean
  children?: FNode[]
  file?: FileEntry
  count: number
}

function buildFileTree(files: FileEntry[]): FNode[] {
  const root: FNode = { name: "", path: "", dir: true, children: [], count: 0 }
  for (const file of files) {
    const parts = file.path.split("/")
    let cur = root
    for (let i = 0; i < parts.length; i++) {
      const leaf = i === parts.length - 1
      cur.children = cur.children || []
      let next = cur.children.find((c) => c.name === parts[i] && c.dir === !leaf)
      if (!next) {
        next = leaf
          ? { name: parts[i], path: file.path, dir: false, file, count: 1 }
          : {
              name: parts[i],
              path: parts.slice(0, i + 1).join("/"),
              dir: true,
              children: [],
              count: 0,
            }
        cur.children.push(next)
      }
      cur = next
    }
  }
  const finalize = (n: FNode) => {
    if (n.children) {
      n.children.forEach(finalize)
      n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    }
    n.count = n.children ? n.children.reduce((a, c) => a + (c.dir ? c.count : 1), 0) : 1
  }
  finalize(root)
  return root.children || []
}

function filesUnder(node: FNode): string[] {
  const out: string[] = []
  const walk = (n: FNode) => {
    if (n.dir) n.children?.forEach(walk)
    else out.push(n.path)
  }
  walk(node)
  return out
}

function FileNodes({
  nodes,
  depth,
  expanded,
  toggle,
  commit,
  shortId,
  t,
  range,
  selected,
  onSelectFile,
}: {
  nodes: FNode[]
  depth: number
  expanded: Set<string>
  toggle: (p: string) => void
  commit: string
  shortId: string
  t: (s: string, p?: any) => string
  range?: { from: string; to: string } | null
  selected: Set<string>
  onSelectFile: (p: string, e: React.MouseEvent) => void
}) {
  const openDiff = (path: string) =>
    range
      ? void store.openRangeDiff(range.from, range.to, path, range.from + ".." + range.to + ": " + path)
      : void store.openDiff({ title: shortId + ": " + path, commit, path })
  return (
    <>
      {nodes.map((n) => {
        if (n.dir) {
          const open = expanded.has(n.path)
          const files = filesUnder(n)
          return (
            <React.Fragment key={"d:" + n.path}>
              <div
                className="dig-dfile-dir"
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => toggle(n.path)}
                onContextMenu={(e) => {
                  const paths = files
                  openContextMenu(e, [
                    {
                      label: t("Cherry-Pick Selected"),
                      run: () => {
                        confirmThen(t("Cherry-pick {n} selected file(s)?", { n: paths.length }), () => {
                          void store.cherryPickSelected(commit, paths)
                        })
                      },
                    },
                    {
                      label: t("Download Selected"),
                      run: () => void store.downloadCommitFiles(commit, paths),
                    },
                  ])
                }}
              >
                <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />
                <Icon name="folder" size={13} style={{ color: "var(--fg-subtle)" }} />
                <span>{n.name}</span>
                <span className="dig-dfile-count">{n.count}</span>
              </div>
              {open && n.children ? (
                <FileNodes
                  nodes={n.children}
                  depth={depth + 1}
                  expanded={expanded}
                  toggle={toggle}
                  commit={commit}
                  shortId={shortId}
                  t={t}
                  range={range}
                  selected={selected}
                  onSelectFile={onSelectFile}
                />
              ) : null}
            </React.Fragment>
          )
        }
        const f = n.file!
        const sel = selected.has(f.path)
        const letter = f.kind === "added" ? "A" : f.kind === "deleted" ? "D" : f.kind === "renamed" ? "R" : "M"
        const color =
          f.kind === "added" ? "var(--vcs-added)" : f.kind === "deleted" ? "var(--vcs-deleted)" : "var(--vcs-modified)"
        return (
          <div
            key={"f:" + n.path}
            className="dig-dfile"
            data-selected={sel ? "true" : undefined}
            style={{ paddingLeft: 22 + depth * 14 }}
            title={f.path}
            onClick={(e) => onSelectFile(f.path, e)}
            onDoubleClick={() => openDiff(f.path)}
            onContextMenu={(e) => {
              const wasSelected = selected.has(f.path)
              if (!wasSelected)
                onSelectFile(f.path, {
                  shiftKey: false,
                  metaKey: false,
                  ctrlKey: false,
                } as unknown as React.MouseEvent)
              const paths = wasSelected && selected.size ? [...selected] : [f.path]
              openContextMenu(e, [
                { label: t("Show Diff"), run: () => openDiff(f.path) },
                { label: t("Show History"), run: () => store.openHistory(f.path) },
                {
                  label: t("Annotate with Git Blame"),
                  run: () => void store.openBlame(f.path, f.path),
                },
                { separator: true },
                {
                  label: t("Cherry-Pick Selected"),
                  run: () => {
                    confirmThen(t("Cherry-pick {n} selected file(s)?", { n: paths.length }), () => {
                      void store.cherryPickSelected(commit, paths)
                    })
                  },
                },
                {
                  label: paths.length > 1 ? t("Download Selected (zip)") : t("Download"),
                  run: () => void store.downloadCommitFiles(commit, paths),
                },
                { separator: true },
                { label: t("Copy Path"), run: () => copyText(f.path) },
                { label: t("Copy Relative Path"), run: () => copyText(f.path) },
              ])
            }}
          >
            <span className="dig-dfile__letter" style={{ color }}>
              {letter}
            </span>
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
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set())
  const commit = s.commits.find((c) => c.id === s.selectedCommit)
  const tree = React.useMemo(() => buildFileTree(s.commitFiles), [s.commitFiles])
  React.useEffect(() => {
    const all = new Set<string>()
    const walk = (ns: FNode[]) =>
      ns.forEach((n) => {
        if (n.dir) {
          all.add(n.path)
          walk(n.children || [])
        }
      })
    walk(tree)
    setExpanded(all)
    setSelected(new Set())
  }, [tree])
  const flatPaths = React.useMemo(() => {
    const out: string[] = []
    const walk = (ns: FNode[]) =>
      ns.forEach((n) => {
        if (n.dir) walk(n.children || [])
        else out.push(n.path)
      })
    walk(tree)
    return out
  }, [tree])
  const anchor = React.useRef<string | null>(null)
  if (!commit)
    return (
      <div className="dig-details">
        <div className="dig-empty">{t("Select a commit to see details")}</div>
      </div>
    )
  const toggle = (p: string) =>
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })
  const onSelectFile = (p: string, e: React.MouseEvent) => {
    setSelected((prev) => {
      let next: Set<string>
      if (e.shiftKey && anchor.current) {
        const a = flatPaths.indexOf(anchor.current),
          b = flatPaths.indexOf(p)
        if (a >= 0 && b >= 0) {
          const [s0, e0] = a < b ? [a, b] : [b, a]
          next = new Set(flatPaths.slice(s0, e0 + 1))
        } else next = new Set([p])
      } else if (e.metaKey || e.ctrlKey) {
        next = new Set(prev)
        if (next.has(p)) next.delete(p)
        else next.add(p)
      } else next = new Set([p])
      return next
    })
    if (!e.shiftKey) anchor.current = p
  }
  return (
    <div className="dig-details">
      <div className="dig-details__fileshead">
        {t("{n} files", { n: s.commitFiles.length })}
        {s.detailRange ? " · " + t("selected commits") : ""}
        {selected.size ? ` · ${t("{n} selected", { n: selected.size })}` : ""}
      </div>
      <div className="dig-details__files">
        <FileNodes
          nodes={tree}
          depth={0}
          expanded={expanded}
          toggle={toggle}
          commit={commit.id}
          shortId={commit.shortId}
          t={t}
          range={s.detailRange}
          selected={selected}
          onSelectFile={onSelectFile}
        />
      </div>
      <div className="dig-details__msg">
        <div className="dig-details__subject">{commit.subject}</div>
        {commit.message && commit.message !== commit.subject ? (
          <div className="dig-details__body">{commit.message.slice(commit.subject.length).trim()}</div>
        ) : null}
        <div className="dig-details__meta">
          <span className="dig-details__hash">{commit.shortId}</span> {commit.author} &lt;
          {commit.authorEmail}&gt; · {formatDate(commit.committerDate)}
        </div>
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
      {
        label: t("Copy Revision Numbers"),
        run: () => copyText(selection.map((x) => x.id).join("\n")),
      },
      { label: t("Create Patch…"), run: () => void store.createPatch({ commit: selection[0].id }) },
      { label: t("Cherry-Pick"), run: () => void store.cherryPick(selection.map((x) => x.id)) },
      { separator: true },
      {
        label: t("Revert Commits"),
        run: () => {
          confirmThen(t("Revert {n} commits?", { n: selection.length }), () => {
            void store.revertCommits(selection.map((x) => x.id))
          })
        },
      },
      {
        label: t("Squash Commits"),
        run: () => {
          confirmThen(t("Squash {n} selected commits into one?", { n: selection.length }), () => {
            void store.squashRange(selection.map((x) => x.id))
          })
        },
      },
      { label: t("Drop Commits"), disabled: true },
    ]
  }
  return [
    { label: t("Copy Revision Number"), run: () => copyText(c.id) },
    { label: t("Copy Commit Message"), run: () => copyText(c.message || c.subject) },
    { label: t("Create Patch…"), run: () => void store.createPatch({ commit: c.id }) },
    { label: t("Interactively Rebase from Here…"), run: () => store.openRebasePlan(c.id) },
    {
      label: t("Edit Commit Message…"),
      run: async () => {
        const m = await askMultiline(t("Commit message"), c.message || c.subject)
        if (m) void store.editCommitMessage(c.id, m)
      },
    },
    {
      label: t("Fixup…"),
      run: () => {
        confirmThen(t("Commit local changes as fixup! {subject}?", { subject: c.subject }), () => {
          void store.fixupCommit(c.subject)
        })
      },
    },
    {
      label: t("Squash Into…"),
      run: () => {
        confirmThen(t("Commit local changes as squash! {subject}?", { subject: c.subject }), () => {
          void store.squashInto(c.subject)
        })
      },
    },
    { separator: true },
    { label: t("Checkout Revision"), run: () => void store.checkout(c.id) },
    { label: t("Compare with Local"), run: () => void store.openCompareWorking(c.id, c.shortId) },
    { separator: true },
    {
      label: t("Reset Current Branch to Here (Soft)"),
      run: () => {
        confirmThen(t("Reset to this commit (soft)?"), () => {
          void store.resetTo(c.id, "soft")
        })
      },
    },
    {
      label: t("Reset Current Branch to Here (Mixed)"),
      run: () => {
        confirmThen(t("Reset to this commit (mixed)?"), () => {
          void store.resetTo(c.id, "mixed")
        })
      },
    },
    {
      label: t("Reset Current Branch to Here (Hard)"),
      danger: true,
      run: () => {
        confirmThen(t("Hard reset to this commit? Uncommitted changes will be lost."), () => {
          void store.resetTo(c.id, "hard")
        })
      },
    },
    {
      label: t("Revert Commit"),
      run: () => {
        confirmThen(t("Revert this commit?"), () => {
          void store.revertCommit(c.id)
        })
      },
    },
    {
      label: t("Undo Commit"),
      run: () => {
        confirmThen(t("Undo the latest commit (keep changes)?"), () => {
          void store.undoLastCommit()
        })
      },
    },
    {
      label: t("Squash into Parent"),
      disabled: store.getState().commits[0]?.id !== c.id || c.parents.length === 0,
      run: () => {
        confirmThen(t("Squash this commit into its parent?"), () => {
          void store.squashHead()
        })
      },
    },
    {
      label: t("Drop Commit"),
      danger: true,
      run: () => {
        const isHead = store.getState().commits[0]?.id === c.id
        confirmThen(t("Drop this commit? Its changes will be discarded."), () => {
          if (isHead) void store.dropHead()
          else void store.dropCommit(c.id)
        })
      },
    },
    { separator: true },
    {
      label: t("New Branch from Here…"),
      run: async () => {
        const n = await askText(t("New branch name"))
        if (n) void store.createBranchAt(n, c.id)
      },
    },
    { label: t("New Tag…"), run: () => store.openTagDialog(c.id) },
    { separator: true },
    { label: t("Cherry-Pick"), run: () => void store.cherryPick([c.id]) },
    { separator: true },
    {
      label: t("Go to Parent Commit"),
      disabled: !c.parents.length,
      run: () => void store.selectCommit(c.parents[0]),
    },
    {
      label: t("Go to Child Commit"),
      disabled: !store.getState().commits.some((x) => x.parents.includes(c.id)),
      run: () => {
        const child = store.getState().commits.find((x) => x.parents.includes(c.id))
        if (child) void store.selectCommit(child.id)
      },
    },
    { label: t("Open in Browser"), run: () => void store.openCommitInBrowser(c.id) },
  ]
}

function branchMenuItems(b: BranchItem, t: (x: string, p?: any) => string) {
  const cur = store.getState().info?.branch?.head || "HEAD"
  if (b.current) {
    return [
      {
        label: t("New Branch from '{name}'…", { name: b.name }),
        run: async () => {
          const n = await askText(t("New branch name"))
          if (n) void store.createBranchAt(n, b.name)
        },
      },
      { separator: true },
      { label: t("Update"), run: () => void store.remoteOp("pull") },
      { label: t("Push…"), run: () => void store.remoteOp("push") },
      { separator: true },
      {
        label: t("Rename…"),
        run: async () => {
          const n = await askText(t("New branch name"), b.name)
          if (n && n !== b.name) void store.renameBranch(b.name, n)
        },
      },
      { label: t("Show History"), run: () => store.openBranchHistory(b.name) },
      { label: t("Show Incoming / Outgoing…"), run: () => void store.openIncomingOutgoing() },
    ]
  }
  return [
    { label: t("Checkout"), run: () => void store.checkout(b.name) },
    {
      label: t("New Branch from '{name}'…", { name: b.name }),
      run: async () => {
        const n = await askText(t("New branch name"))
        if (n) void store.createBranchAt(n, b.name)
      },
    },
    {
      label: t("Checkout and Rebase onto '{cur}'", { cur }),
      disabled: b.remote,
      run: () => {
        confirmThen(t("Checkout '{name}' and rebase onto '{cur}'?", { name: b.name, cur }), () => {
          void store.checkoutAndRebase(b.name, cur)
        })
      },
    },
    {
      label: t("Show Diff with Working Tree"),
      run: () => void store.openCompare(b.name, "WORKTREE", b.name),
    },
    { separator: true },
    { label: t("Show History"), run: () => store.openBranchHistory(b.name) },
    {
      label: t("Compare with Current"),
      disabled: b.current,
      run: () => void store.openCompare(b.name, "HEAD", b.name),
    },
    {
      label: t("Compare Commits with Current…"),
      run: () => void store.openCompareCommits(b.name, "HEAD"),
    },
    {
      label: t("Compare with Revision…"),
      run: async () => {
        const ref = await chooseRef(t("Branch or revision"))
        if (ref) void store.openCompare(b.name, ref, `${b.name} ↔ ${ref}`)
      },
    },
    {
      label: isFavorite(b.name) ? t("Remove from Favorites") : t("Add to Favorites"),
      run: () => {
        const on = !isFavorite(b.name)
        toggleFavorite(b.name)
        store.setToast(on ? t("Added to Favorites") + ": " + b.name : t("Removed from Favorites") + ": " + b.name)
        void store.refreshAll()
      },
    },
    { label: t("Copy Branch Name"), run: () => copyText(b.name) },
    { separator: true },
    {
      label: t("Merge '{name}' into Current", { name: b.name }),
      run: () => {
        confirmThen(t("Merge {name} into current branch?", { name: b.name }), () => {
          void store.mergeBranch(b.name)
        })
      },
    },
    ...(b.remote
      ? [
          {
            label: t("Pull into '{cur}' Using Rebase", { cur }),
            run: () => {
              const i = b.name.indexOf("/")
              if (i > 0) void store.pullInto(b.name.slice(0, i), b.name.slice(i + 1), true)
            },
          },
          {
            label: t("Pull into '{cur}' Using Merge", { cur }),
            run: () => {
              const i = b.name.indexOf("/")
              if (i > 0) void store.pullInto(b.name.slice(0, i), b.name.slice(i + 1), false)
            },
          },
        ]
      : []),
    ...(b.remote
      ? []
      : [
          { separator: true },
          {
            label: t("Rebase '{cur}' onto '{name}'", { cur, name: b.name }),
            run: () => {
              confirmThen(t("Rebase '{cur}' onto '{name}'?", { cur, name: b.name }), () => {
                void store.rebaseBranch(b.name)
              })
            },
          },
          {
            label: t("Rename…"),
            run: async () => {
              const n = await askText(t("New branch name"), b.name)
              if (n && n !== b.name) void store.renameBranch(b.name, n)
            },
          },
          {
            label: t("Delete"),
            danger: true,
            run: () => {
              confirmThen(t("Delete branch {name}?", { name: b.name }), () => {
                void store.deleteBranch(b.name)
              })
            },
          },
          {
            label: t("Force Delete"),
            danger: true,
            run: () => {
              confirmThen(t("Force delete branch {name}? Unmerged commits will be lost.", { name: b.name }), () => {
                void store.deleteBranch(b.name, true)
              })
            },
          },
        ]),
  ]
}

function CommitRow({
  commit,
  row,
  selected,
  selection,
}: {
  commit: CommitItem
  row: GraphRow
  selected: boolean
  selection: CommitItem[]
}) {
  const t = useT()
  return (
    <div
      className="dig-crow"
      data-selected={selected ? "true" : undefined}
      onClick={(e) =>
        void store.selectCommit(commit.id, e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "single")
      }
      title={commit.subject}
      onContextMenu={(e) => openContextMenu(e, commitMenuItems(commit, selection, t))}
    >
      <GraphCell row={row} />
      <span className="dig-crow__subject">
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{commit.subject}</span>
        {commit.refs.length ? (
          <span className="dig-refs">
            {commit.refs.map((r) => (
              <RefLabel key={r} name={r} />
            ))}
          </span>
        ) : null}
      </span>
      <span className="dig-crow__author">{commit.author}</span>
      <span className="dig-crow__date">{formatDate(commit.authorDate)}</span>
    </div>
  )
}

function CommitList({
  text,
  regex,
  caseSensitive,
  author,
  dateDays,
}: {
  text: string
  regex: boolean
  caseSensitive: boolean
  author: string | null
  dateDays: number | null
}) {
  const s = useGit()
  const t = useT()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const filtered = React.useMemo(() => {
    let list = s.commits
    const q = text.trim()
    if (q) {
      let re: RegExp | null = null
      if (regex) {
        try {
          re = new RegExp(q, caseSensitive ? "" : "i")
        } catch {
          re = null
        }
      }
      list = list.filter((c) => {
        const hay = [c.subject, c.author, c.shortId, c.refs.join(" ")].join(" ")
        if (re) return re.test(hay)
        return caseSensitive ? hay.includes(q) : hay.toLowerCase().includes(q.toLowerCase())
      })
    }
    if (author) list = list.filter((c) => c.author === author)
    if (dateDays != null) {
      const cut = Date.now() - dateDays * 86400000
      list = list.filter((c) => c.committerDate >= cut)
    }
    return list
  }, [s.commits, text, regex, caseSensitive, author, dateDays])
  const rows = React.useMemo(() => {
    if (!filtered.length) return [] as GraphRow[]
    return computeGraph(
      filtered.map((c) => ({ id: c.id, parents: c.parents })),
      emptyGraphState(),
    ).rows
  }, [filtered])
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      if (s.logHasMore && !s.logLoading && el.scrollTop + el.clientHeight >= el.scrollHeight - 200)
        void store.loadLog(false)
    }
    el.addEventListener("scroll", onScroll)
    return () => el.removeEventListener("scroll", onScroll)
  }, [s.logHasMore, s.logLoading])
  return (
    <div className="dig-commitlist" ref={scrollRef}>
      {filtered.length === 0 ? <div className="dig-empty">{s.logLoading ? t("Loading") : t("No commits")}</div> : null}
      {filtered.map((c, i) => (
        <CommitRow
          key={c.id}
          commit={c}
          row={rows[i]}
          selected={s.selectedCommit === c.id || s.selection.includes(c.id)}
          selection={s.selection.includes(c.id) ? s.commits.filter((x) => s.selection.includes(x.id)) : [c]}
        />
      ))}
      {s.logLoading ? <div className="dig-empty">{t("Loading")}</div> : null}
    </div>
  )
}

function FilterBar({
  text,
  setText,
  regex,
  setRegex,
  caseSensitive,
  setCase,
  author,
  setAuthor,
  dateDays,
  setDateDays,
}: {
  text: string
  setText: (v: string) => void
  regex: boolean
  setRegex: (v: boolean) => void
  caseSensitive: boolean
  setCase: (v: boolean) => void
  author: string | null
  setAuthor: (v: string | null) => void
  dateDays: number | null
  setDateDays: (v: number | null) => void
}) {
  const s = useGit()
  const t = useT()
  const authors = React.useMemo(() => [...new Set(s.commits.map((c) => c.author))].sort().slice(0, 40), [s.commits])
  const dateOpts: Array<{ v: number | null; label: string }> = [
    { v: null, label: t("All time") },
    { v: 1, label: t("Today") },
    { v: 7, label: t("Last 7 days") },
    { v: 30, label: t("Last 30 days") },
  ]
  return (
    <div className="dig-filterbar">
      <div className="dig-searchwrap">
        <Icon name="search" size={13} style={{ color: "var(--fg-subtle)" }} />
        <input
          className="dig-search"
          placeholder={t("Text or hash")}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className="dig-toggle"
          data-on={regex ? "true" : undefined}
          title={t("Regex")}
          onClick={() => setRegex(!regex)}
        >
          .*
        </button>
        <button
          type="button"
          className="dig-toggle"
          data-on={caseSensitive ? "true" : undefined}
          title={t("Case sensitive")}
          onClick={() => setCase(!caseSensitive)}
        >
          Cc
        </button>
      </div>
      {s.info?.branch?.head ? (
        <span className="dig-chip dig-chip--static" title={s.info.branch.head}>
          {t("Branch")}: {s.info.branch.head}
        </span>
      ) : null}
      <Dropdown
        align="right"
        trigger={() => (
          <span className="dig-filterbtn" data-active={author ? "true" : undefined}>
            {author || t("User")}
            <Icon name="chevronDown" size={12} style={{ marginLeft: 2, color: "var(--fg-subtle)" }} />
          </span>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              checked={!author}
              onClick={() => {
                close()
                setAuthor(null)
              }}
            >
              {t("All users")}
            </MenuItem>
            {authors.map((a) => (
              <MenuItem
                key={a}
                checked={author === a}
                onClick={() => {
                  close()
                  setAuthor(a)
                }}
              >
                {a}
              </MenuItem>
            ))}
          </>
        )}
      </Dropdown>
      <Dropdown
        align="right"
        trigger={() => (
          <span className="dig-filterbtn" data-active={dateDays != null ? "true" : undefined}>
            {dateDays != null ? dateOpts.find((o) => o.v === dateDays)?.label || t("Date") : t("Date")}
            <Icon name="chevronDown" size={12} style={{ marginLeft: 2, color: "var(--fg-subtle)" }} />
          </span>
        )}
      >
        {(close) => (
          <>
            {dateOpts.map((o) => (
              <MenuItem
                key={String(o.v)}
                checked={dateDays === o.v}
                onClick={() => {
                  close()
                  setDateDays(o.v)
                }}
              >
                {o.label}
              </MenuItem>
            ))}
          </>
        )}
      </Dropdown>
      <Dropdown
        align="right"
        trigger={() => (
          <span className="dig-filterbtn" data-active={s.logPath ? "true" : undefined}>
            {s.logPath ? s.logPath : t("Paths")}
            <Icon name="chevronDown" size={12} style={{ marginLeft: 2, color: "var(--fg-subtle)" }} />
          </span>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              onClick={async () => {
                close()
                const p = await askText(t("Filter by path"), s.logPath || "")
                if (p) store.setPathFilter(p)
              }}
            >
              {t("Filter by Path…")}
            </MenuItem>
            {s.logPath ? (
              <MenuItem
                onClick={() => {
                  close()
                  store.clearPathFilter()
                }}
              >
                {t("Clear filter")}
              </MenuItem>
            ) : null}
          </>
        )}
      </Dropdown>
      <button
        type="button"
        className="dig-filterbtn"
        data-active={s.logHeadOnly ? "true" : undefined}
        title={s.logHeadOnly ? t("Current branch") : t("All branches")}
        onClick={() => store.setLogHeadOnly(!s.logHeadOnly)}
      >
        {s.logHeadOnly ? t("Current branch") : t("All branches")}
      </button>
      <Dropdown
        align="right"
        trigger={() => (
          <span className="dig-filterbtn" title={t("View Options")}>
            {t("View")} ▾
          </span>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              checked={s.logFirstParent}
              onClick={() => {
                close()
                store.setLogFirstParent(!s.logFirstParent)
              }}
            >
              {t("First parent only")}
            </MenuItem>
            <MenuItem
              checked={s.logNoMerges}
              onClick={() => {
                close()
                store.setLogNoMerges(!s.logNoMerges)
              }}
            >
              {t("No merges")}
            </MenuItem>
          </>
        )}
      </Dropdown>
      <Dropdown
        align="right"
        trigger={() => (
          <span className="dig-filterbtn" title={t("Sort")}>
            {s.logSort === "reverse"
              ? t("Sort: Date (old→new)")
              : s.logSort === "topo"
                ? t("Sort: Topology")
                : t("Sort: Date (new→old)")}
            <Icon name="chevronDown" size={12} style={{ marginLeft: 2, color: "var(--fg-subtle)" }} />
          </span>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              checked={s.logSort === "date"}
              onClick={() => {
                close()
                store.setLogSort("date")
              }}
            >
              {t("Sort: Date (new→old)")}
            </MenuItem>
            <MenuItem
              checked={s.logSort === "reverse"}
              onClick={() => {
                close()
                store.setLogSort("reverse")
              }}
            >
              {t("Sort: Date (old→new)")}
            </MenuItem>
            <MenuItem
              checked={s.logSort === "topo"}
              onClick={() => {
                close()
                store.setLogSort("topo")
              }}
            >
              {t("Sort: Topology")}
            </MenuItem>
          </>
        )}
      </Dropdown>
      <span style={{ flex: 1 }} />
      <IconButton icon="refresh" title={t("Refresh log")} onClick={() => void store.loadLog(true)} />
    </div>
  )
}

export function LogView() {
  const s = useGit()
  const t = useT()
  const [showBranches, setShowBranches] = React.useState(() => localStorage.getItem("dig.showBranches") !== "0")
  const hideBranches = () => {
    setShowBranches(false)
    try {
      localStorage.setItem("dig.showBranches", "0")
    } catch {}
  }
  const showBranchesNow = () => {
    setShowBranches(true)
    try {
      localStorage.setItem("dig.showBranches", "1")
    } catch {}
  }
  const [text, setText] = React.useState("")
  const [regex, setRegex] = React.useState(false)
  const [caseSensitive, setCase] = React.useState(false)
  const [author, setAuthor] = React.useState<string | null>(null)
  const [dateDays, setDateDays] = React.useState<number | null>(null)
  const center = (
    <div className="dig-log">
      <FilterBar
        text={text}
        setText={setText}
        regex={regex}
        setRegex={setRegex}
        caseSensitive={caseSensitive}
        setCase={setCase}
        author={author}
        setAuthor={setAuthor}
        dateDays={dateDays}
        setDateDays={setDateDays}
      />
      {s.logBranch ? (
        <div className="dig-historybar">
          <span className="dig-chip">
            {t("Branch")}: {s.logBranch}
            <button type="button" className="dig-chip__x" onClick={() => store.clearBranchHistory()}>
              ✕
            </button>
          </span>
        </div>
      ) : null}
      {s.logFilterFile ? (
        <div className="dig-historybar">
          <span className="dig-chip">
            {t("History: {file}", { file: s.logFilterFile })}
            <button type="button" className="dig-chip__x" onClick={() => store.clearHistory()}>
              ✕
            </button>
          </span>
        </div>
      ) : null}
      <div className="dig-listhead">
        <span style={{ width: 70 }}>{t("Graph")}</span>
        <span style={{ flex: 1 }}>{t("Subject")}</span>
        <span style={{ width: 120 }}>{t("Author")}</span>
        <span style={{ width: 130 }}>{t("Date")}</span>
      </div>
      <CommitList text={text} regex={regex} caseSensitive={caseSensitive} author={author} dateDays={dateDays} />
    </div>
  )
  const right = <DetailsPane />
  if (!showBranches)
    return (
      <div className="dig-hlayout">
        <div className="dig-log__restore" title={t("Show Branches")} onClick={showBranchesNow}>
          <Icon name="chevronRight" size={14} />
        </div>
        {center}
      </div>
    )
  return (
    <div className="dig-hlayout">
      <SplitPane
        orientation="horizontal"
        first={<BranchesPanel onHide={hideBranches} />}
        second={
          <SplitPane
            orientation="horizontal"
            first={center}
            second={right}
            initial={Math.max(320, (typeof window !== "undefined" ? window.innerWidth : 900) - 780)}
            min={240}
            storageKey="logDetails"
          />
        }
        initial={240}
        min={160}
        max={420}
        storageKey="branches"
      />
    </div>
  )
}
