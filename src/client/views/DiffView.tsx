/** IDEA-style diff viewer: split/unified, whitespace & highlight policies, folds. */
import React from "react"
import { useGit, Icon, IconButton } from "../lib/ui"
import { useT } from "../lib/i18n"
import { computeRows, wordRanges, type DiffRow, type IgnorePolicy } from "../lib/textdiff"
import * as store from "../store"
import { openContextMenu } from "../lib/contextMenu"
import styles from "../vendor/vcs/DiffEditor.module.css"

type Mode = "split" | "unified"
type Highlight = "words" | "lines" | "none"

interface Opts {
  mode: Mode
  ignore: IgnorePolicy
  highlight: Highlight
  collapse: boolean
  swap: boolean
}

const DEFAULTS: Opts = {
  mode: "split",
  ignore: "none",
  highlight: "words",
  collapse: true,
  swap: false,
}
const KEY = "dig.diffOpts"

function loadOpts(): Opts {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null")
    if (raw && typeof raw === "object") return { ...DEFAULTS, ...raw }
  } catch {}
  return DEFAULTS
}
function saveOpts(o: Opts) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o))
  } catch {}
}

function ToolSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
}) {
  return (
    <select
      className={"dig-dsel " + (styles as any).select}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={options.find((o) => o.value === value)?.label}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

const HASH_COMMENT = new Set(["py", "sh", "bash", "zsh", "rb", "yaml", "yml", "toml", "ini"])
const KW = new Set(
  "const let var function return if else for while class import export from new await async def None True False self elif try except raise with as in not and or public private protected static void int string bool true false null undefined struct impl fn mut pub use match case break continue switch throw catch finally interface type enum extends implements package go defer chan map range func".split(
    " ",
  ),
)

function highlightCode(text: string, lang: string): React.ReactNode {
  if (!text) return "\u00a0"
  const parts: React.ReactNode[] = []
  const hash = HASH_COMMENT.has(lang)
  const re = new RegExp(
    (hash ? "#[^\n]*" : "//[^\n]*") +
      "|/\\*.*?\\*/" +
      "|'(?:[^'\\\\]|\\\\.)*'" +
      '|"(?:[^"\\\\]|\\\\.)*"' +
      "|`(?:[^`\\\\]|\\\\.)*`" +
      "|\\b\\d+(?:\\.\\d+)?\\b" +
      "|\\b[A-Za-z_$][A-Za-z0-9_$]*\\b",
    "g",
  )
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const tok = m[0]
    let cls = ""
    if ((hash && tok.startsWith("#")) || tok.startsWith("//") || tok.startsWith("/*")) cls = "dig-tok-com"
    else if (/^['"`]/.test(tok)) cls = "dig-tok-str"
    else if (/^\d/.test(tok)) cls = "dig-tok-num"
    else if (KW.has(tok)) cls = "dig-tok-kw"
    parts.push(
      cls ? (
        <span key={parts.length} className={cls}>
          {tok}
        </span>
      ) : (
        tok
      ),
    )
    last = m.index + tok.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function Fragments({ text, other, enabled, lang }: { text: string; other: string; enabled: boolean; lang?: string }) {
  const code = (t: string) => highlightCode(t, lang || "")
  if (!enabled || text === other) return <>{code(text)}</>
  const r = wordRanges(text, other)
  if (r.aStart >= r.aEnd) return <>{code(text)}</>
  return (
    <>
      {code(text.slice(0, r.aStart))}
      <mark className="dig-word">{code(text.slice(r.aStart, r.aEnd))}</mark>
      {code(text.slice(r.aEnd))}
    </>
  )
}

type Item = { fold: true; count: number; start: number } | { fold: false; row: DiffRow; index: number }

function buildItems(rows: DiffRow[], collapse: boolean, expanded: Set<number>): Item[] {
  const items: Item[] = []
  let i = 0
  while (i < rows.length) {
    if (rows[i].kind === "ctx") {
      let j = i
      while (j < rows.length && rows[j].kind === "ctx") j++
      const count = j - i
      if (collapse && count >= 4 && !expanded.has(i)) items.push({ fold: true, count, start: i })
      else for (let k = i; k < j; k++) items.push({ fold: false, row: rows[k], index: k })
      i = j
      continue
    }
    items.push({ fold: false, row: rows[i], index: i })
    i++
  }
  return items
}

function FoldButton({ count, onExpand }: { count: number; onExpand: () => void }) {
  const t = useT()
  return (
    <button type="button" className="dig-difffold" onClick={onExpand}>
      ⋯ {t("{n} unchanged lines — click to expand", { n: count })}
    </button>
  )
}

function SplitView({
  rows,
  highlight,
  collapse,
  expanded,
  onExpand,
  lang,
  hunkStart,
  excluded,
  onToggleHunk,
  hunkLabel,
}: {
  rows: DiffRow[]
  highlight: Highlight
  collapse: boolean
  expanded: Set<number>
  onExpand: (start: number) => void
  lang?: string
  hunkStart?: Map<number, number>
  excluded?: Set<number>
  onToggleHunk?: (i: number) => void
  hunkLabel?: string
}) {
  const items = React.useMemo(() => buildItems(rows, collapse, expanded), [rows, collapse, expanded])
  return (
    <div className="dig-diff__split">
      {items.map((it, k) =>
        it.fold ? (
          <FoldButton key={"f" + k} count={it.count} onExpand={() => onExpand(it.start)} />
        ) : (
          <div key={"r" + it.index} className={"dig-dsrow dig-dsrow--" + it.row.kind}>
            <span className="dig-dsrow__no">{it.row.oldNo ?? ""}</span>
            <span className="dig-dsrow__cell dig-dsrow__cell--old">
              {it.row.oldNo != null ? (
                <Fragments text={it.row.oldText} other={it.row.newText} enabled={highlight === "words"} lang={lang} />
              ) : null}
            </span>
            <span className="dig-dsrow__no">
              {it.row.newNo ?? ""}
              {hunkStart && it.row.newNo != null && hunkStart.has(it.row.newNo) ? (
                <input
                  type="checkbox"
                  className="dig-hunkcheck"
                  title={hunkLabel}
                  checked={!excluded?.has(hunkStart.get(it.row.newNo)!)}
                  onChange={() => onToggleHunk?.(hunkStart.get(it.row.newNo!)!)}
                />
              ) : null}
            </span>
            <span className="dig-dsrow__cell dig-dsrow__cell--new">
              {it.row.newNo != null ? (
                <Fragments text={it.row.newText} other={it.row.oldText} enabled={highlight === "words"} lang={lang} />
              ) : null}
            </span>
          </div>
        ),
      )}
    </div>
  )
}

function UnifiedView({
  rows,
  highlight,
  collapse,
  expanded,
  onExpand,
  lang,
  hunkStart,
  excluded,
  onToggleHunk,
  hunkLabel,
}: {
  rows: DiffRow[]
  highlight: Highlight
  collapse: boolean
  expanded: Set<number>
  onExpand: (start: number) => void
  lang?: string
  hunkStart?: Map<number, number>
  excluded?: Set<number>
  onToggleHunk?: (i: number) => void
  hunkLabel?: string
}) {
  const items = React.useMemo(() => buildItems(rows, collapse, expanded), [rows, collapse, expanded])
  const lines: React.ReactNode[] = []
  for (const it of items) {
    if (it.fold) {
      lines.push(<FoldButton key={"f" + lines.length} count={it.count} onExpand={() => onExpand(it.start)} />)
      continue
    }
    const r = it.row
    if (r.kind === "ctx") {
      lines.push(
        <div key={lines.length} className="dig-durow">
          <span className="dig-durow__no">{r.oldNo}</span>
          <span className="dig-durow__no">
            {r.newNo}
            {hunkStart && r.newNo != null && hunkStart.has(r.newNo) ? (
              <input
                type="checkbox"
                className="dig-hunkcheck"
                title={hunkLabel}
                checked={!excluded?.has(hunkStart.get(r.newNo)!)}
                onChange={() => onToggleHunk?.(hunkStart.get(r.newNo!)!)}
              />
            ) : null}
          </span>
          <span className="dig-durow__sign" />
          <span className="dig-durow__text">{r.oldText || "\u00a0"}</span>
        </div>,
      )
    } else {
      if (r.oldNo != null)
        lines.push(
          <div key={lines.length} className="dig-durow dig-durow--del">
            <span className="dig-durow__no">{r.oldNo}</span>
            <span className="dig-durow__no" />
            <span className="dig-durow__sign">−</span>
            <span className="dig-durow__text">
              <Fragments text={r.oldText} other={r.newText} enabled={highlight === "words"} lang={lang} />
            </span>
          </div>,
        )
      if (r.newNo != null)
        lines.push(
          <div key={lines.length} className="dig-durow dig-durow--add">
            <span className="dig-durow__no" />
            <span className="dig-durow__no">
              {r.newNo}
              {hunkStart && r.newNo != null && hunkStart.has(r.newNo) ? (
                <input
                  type="checkbox"
                  className="dig-hunkcheck"
                  title={hunkLabel}
                  checked={!excluded?.has(hunkStart.get(r.newNo)!)}
                  onChange={() => onToggleHunk?.(hunkStart.get(r.newNo!)!)}
                />
              ) : null}
            </span>
            <span className="dig-durow__sign">＋</span>
            <span className="dig-durow__text">
              <Fragments text={r.newText} other={r.oldText} enabled={highlight === "words"} lang={lang} />
            </span>
          </div>,
        )
    }
  }
  return <div className="dig-diff__unified">{lines}</div>
}

function ImageView({ d, t }: { d: NonNullable<ReturnType<typeof useGit>["diff"]>; t: (s: string, p?: any) => string }) {
  const src = (b64?: string) => (b64 ? `data:${d.mime || "application/octet-stream"};base64,${b64}` : "")
  return (
    <div className="dig-imgdiff">
      <div className="dig-imgpane">
        <div className="dig-imgpane__label">{d.oldLabel || t("Before")}</div>
        {d.oldB64 ? (
          <img className="dig-imgpane__img" src={src(d.oldB64)} alt="old" />
        ) : (
          <div className="dig-empty">{t("No image")}</div>
        )}
      </div>
      <div className="dig-imgpane">
        <div className="dig-imgpane__label">{d.newLabel || t("After")}</div>
        {d.newB64 ? (
          <img className="dig-imgpane__img" src={src(d.newB64)} alt="new" />
        ) : (
          <div className="dig-empty">{t("No image")}</div>
        )}
      </div>
    </div>
  )
}

export function DiffView({ bottom, theme }: { bottom: number; theme: "light" | "dark" }) {
  const s = useGit()
  const t = useT()
  const [opts, setOpts] = React.useState<Opts>(loadOpts)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState("")
  const [findOpen, setFindOpen] = React.useState(false)
  const [findText, setFindText] = React.useState("")
  const [wrap, setWrap] = React.useState<boolean>(() => localStorage.getItem("dig.diffWrap") === "1")
  const findAt = React.useRef(0)
  const [expanded, setExpanded] = React.useState<Set<number>>(() => new Set())
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const d = s.diff
  const b = s.blame
  const [hunks, setHunks] = React.useState<Array<{ index: number; header: string }>>([])
  React.useEffect(() => {
    let live = true
    const file = d?.file
    if (file && !d?.commit)
      store
        .listHunks(file, !!d?.staged)
        .then((hs) => {
          if (live) setHunks(hs)
        })
        .catch(() => {
          if (live) setHunks([])
        })
    else setHunks([])
    return () => {
      live = false
    }
  }, [d?.file, d?.commit, d?.staged])

  const update = (patch: Partial<Opts>) =>
    setOpts((o) => {
      const n = { ...o, ...patch }
      saveOpts(n)
      return n
    })

  const rows = React.useMemo(() => {
    if (!d || d.loading || (d.kind && d.kind !== "text")) return [] as DiffRow[]
    const oldText = d.oldText ?? ""
    const newText = d.newText ?? ""
    return opts.swap ? computeRows(newText, oldText, opts.ignore) : computeRows(oldText, newText, opts.ignore)
  }, [d?.oldText, d?.newText, opts.ignore, opts.swap, d?.loading])

  React.useEffect(() => {
    setExpanded(new Set())
  }, [d?.file, d?.commit])

  const goto = (dir: 1 | -1) => {
    const el = bodyRef.current
    if (!el) return
    const marks = Array.from(
      el.querySelectorAll<HTMLElement>(
        ".dig-dsrow--rep, .dig-dsrow--add, .dig-dsrow--del, .dig-durow--add, .dig-durow--del",
      ),
    )
    if (!marks.length) return
    const top = el.scrollTop
    const target =
      dir === 1 ? marks.find((m) => m.offsetTop > top + 4) : [...marks].reverse().find((m) => m.offsetTop < top - 4)
    if (target) el.scrollTop = target.offsetTop - 12
  }

  if (!d && !b) return null
  const lang = (d?.file || "").split(".").pop()?.toLowerCase() || ""
  const hunkStart = new Map<number, number>()
  for (const h of hunks) {
    const m = /\+(\d+)/.exec(h.header)
    if (m) hunkStart.set(Number(m[1]), h.index)
  }
  const excluded = new Set<number>(d?.file ? s.excludedHunks?.[d.file] || [] : [])
  const title = b ? b.title : d!.title

  return (
    <div className="dig-theme dig-diffarea" data-theme={theme} data-wrap={wrap ? "true" : undefined} style={{ bottom }}>
      <div className="dig-diff__head">
        <Icon name="file" size={15} />
        <span className="dig-diff__title" title={title}>
          {title}
        </span>
        {d?.lfs ? <span className="dig-lfs-badge">LFS</span> : null}
        <span style={{ flex: 1 }} />
        {b ? (
          <button type="button" className="dig-btn" onClick={() => store.clearBlame()}>
            {t("Diff")}
          </button>
        ) : d && d.file && !d.commit ? (
          <>
            <button
              type="button"
              className="dig-btn"
              onClick={() => {
                setDraft(d.newText || "")
                setEditing(true)
              }}
            >
              {t("Edit")}
            </button>
            <button
              type="button"
              className="dig-btn"
              onClick={async (ev) => {
                const items = await store.listHunks(d.file!, !!d.staged)
                if (!items.length) return
                openContextMenu(
                  ev as any,
                  items.map((h) => ({
                    label: h.header + "  " + t(d.staged ? "Unstage Hunk" : "Stage Hunk"),
                    run: () => void store.applyHunks(d.file!, [h.index], d.staged ? "unstage" : "stage"),
                  })),
                )
              }}
            >
              {t(d.staged ? "Unstage Hunk…" : "Stage Hunk…")}
            </button>
            <button
              type="button"
              className="dig-btn"
              onClick={() => {
                store.closeDiff()
                store.openHistory(d.file!)
              }}
            >
              {t("History")}
            </button>
            <button type="button" className="dig-btn" onClick={() => void store.openBlame(d.file!, d.file!)}>
              {t("Blame")}
            </button>
          </>
        ) : null}
        <IconButton icon="close" title={t("Close")} onClick={() => store.closeDiff()} />
      </div>

      {!b && d?.kind !== "image" && d?.kind !== "binary" ? (
        <div className={styles.toolbar} role="toolbar">
          <IconButton icon="chevronDown" title={t("Previous change")} onClick={() => goto(-1)} />
          <IconButton icon="chevronRight" title={t("Next change")} onClick={() => goto(1)} />
          <IconButton icon="search" title={t("Find")} onClick={() => setFindOpen((v) => !v)} />
          <button
            type="button"
            className="dig-diffwrapbtn"
            data-active={wrap ? "true" : undefined}
            title={t("Word wrap")}
            onClick={() => {
              const v = !wrap
              setWrap(v)
              try {
                localStorage.setItem("dig.diffWrap", v ? "1" : "0")
              } catch {}
            }}
          >
            ↩
          </button>
          <span className={styles.sep} />
          <div className="dig-seg">
            <button
              type="button"
              className="dig-seg__btn"
              data-active={opts.mode === "split" ? "true" : undefined}
              title={t("Side-by-side")}
              onClick={() => update({ mode: "split" })}
            >
              <span className="dig-seg__split" />
            </button>
            <button
              type="button"
              className="dig-seg__btn"
              data-active={opts.mode === "unified" ? "true" : undefined}
              title={t("Unified")}
              onClick={() => update({ mode: "unified" })}
            >
              <span className="dig-seg__unified" />
            </button>
          </div>
          <ToolSelect
            value={opts.ignore}
            onChange={(v) => update({ ignore: v as IgnorePolicy })}
            options={[
              { value: "none", label: t("Do not ignore") },
              { value: "trim", label: t("Trim whitespaces") },
              { value: "whitespace", label: t("Ignore whitespaces") },
              { value: "whitespaceAndLines", label: t("Ignore whitespaces and empty lines") },
            ]}
          />
          <ToolSelect
            value={opts.highlight}
            onChange={(v) => update({ highlight: v as Highlight })}
            options={[
              { value: "words", label: t("Highlight words") },
              { value: "lines", label: t("Highlight lines") },
              { value: "none", label: t("Do not highlight") },
            ]}
          />
          <span className={styles.sep} />
          <IconButton icon="undo" title={t("Swap sides")} onClick={() => update({ swap: !opts.swap })} />
          <IconButton
            icon="minus"
            title={t("Collapse unchanged")}
            active={opts.collapse}
            onClick={() => update({ collapse: !opts.collapse })}
          />
          <span style={{ flex: 1 }} />
          <span className={styles.count}>{t("{n} changes", { n: rows.filter((r) => r.kind !== "ctx").length })}</span>
        </div>
      ) : null}

      {findOpen ? (
        <div className="dig-difffind">
          <input
            autoFocus
            placeholder={t("Find in diff")}
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return
              const el = bodyRef.current
              if (!el || !findText) return
              const rows = Array.from(el.querySelectorAll<HTMLElement>(".dig-dsrow, .dig-durow")).filter((r) =>
                (r.textContent || "").includes(findText),
              )
              if (!rows.length) return
              findAt.current = (findAt.current + (e.shiftKey ? rows.length - 1 : 1)) % rows.length
              rows[findAt.current].scrollIntoView({ block: "center" })
            }}
          />
          <span className="dig-difffind__hint">{t("Enter = next, Shift+Enter = previous")}</span>
        </div>
      ) : null}

      <div className="dig-diff__body" ref={bodyRef}>
        {b ? (
          b.loading ? (
            <div className="dig-empty">{t("Loading")}</div>
          ) : (
            <div className="dig-blame">
              {b.lines.map((l) => (
                <div className="dig-blameline" key={l.line}>
                  <span className="dig-blameline__sha" title={l.sha}>
                    {l.shortSha}
                  </span>
                  <span className="dig-blameline__author">{l.author}</span>
                  <span className="dig-blameline__time">{new Date(l.time).toISOString().slice(0, 10)}</span>
                  <span className="dig-blameline__code">{l.content || " "}</span>
                </div>
              ))}
            </div>
          )
        ) : d!.loading ? (
          <div className="dig-empty">{t("Loading")}</div>
        ) : d!.kind === "image" ? (
          <ImageView d={d!} t={t} />
        ) : d!.kind === "binary" ? (
          <div className="dig-empty" style={{ flexDirection: "column", gap: 8 }}>
            <span>{t("Binary file")}</span>
            {d!.lfs ? <span className="dig-lfs-note">{t("Git LFS object")}</span> : null}
          </div>
        ) : rows.length === 0 ? (
          <div className="dig-empty">{t("No differences")}</div>
        ) : opts.mode === "split" ? (
          <SplitView
            rows={rows}
            highlight={opts.highlight}
            collapse={opts.collapse}
            expanded={expanded}
            onExpand={(start) => setExpanded((e) => new Set(e).add(start))}
            lang={lang}
            hunkStart={hunkStart}
            excluded={excluded}
            onToggleHunk={(i) => d?.file && store.toggleHunkExcluded(d.file, i)}
            hunkLabel={t("Include in commit")}
          />
        ) : (
          <UnifiedView
            rows={rows}
            highlight={opts.highlight}
            collapse={opts.collapse}
            expanded={expanded}
            onExpand={(start) => setExpanded((e) => new Set(e).add(start))}
            lang={lang}
            hunkStart={hunkStart}
            excluded={excluded}
            onToggleHunk={(i) => d?.file && store.toggleHunkExcluded(d.file, i)}
            hunkLabel={t("Include in commit")}
          />
        )}
      </div>
      {editing && d && d.file ? (
        <div className="dig-edit-overlay">
          <div className="dig-edit-overlay__bar">
            <span>
              {t("Editing worktree file")}: {d.file}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="dig-btn" onClick={() => setEditing(false)}>
              {t("Cancel")}
            </button>
            <button
              type="button"
              className="dig-btn"
              onClick={() => {
                setEditing(false)
                void store.saveWorktreeFile(d.file!, draft, false)
              }}
            >
              {t("Save")}
            </button>
            <button
              type="button"
              className="dig-btn dig-btn--primary"
              onClick={() => {
                setEditing(false)
                void store.saveWorktreeFile(d.file!, draft, true)
              }}
            >
              {t("Save & Stage")}
            </button>
          </div>
          <textarea
            className="dig-edit-overlay__text"
            value={draft}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
      ) : null}
    </div>
  )
}
