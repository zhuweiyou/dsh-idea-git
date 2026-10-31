/** Merge editor: per-hunk choose Ours / Theirs / Both, then apply and mark resolved. */
import React from "react"
import { useGit, Icon, IconButton } from "../lib/ui"
import { useT } from "../lib/i18n"
import * as store from "../store"

type Seg = { type: "text"; text: string } | { type: "conflict"; ours: string; theirs: string; base?: string }

function parseConflicts(text: string): Seg[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const segs: Seg[] = []
  let buf: string[] = []
  const flush = () => {
    if (buf.length) {
      segs.push({ type: "text", text: buf.join("\n") })
      buf = []
    }
  }
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l.startsWith("<<<<<<<")) {
      flush()
      i++
      const ours: string[] = []
      while (i < lines.length && !lines[i].startsWith("|||||||") && !lines[i].startsWith("=======")) {
        ours.push(lines[i])
        i++
      }
      let base: string[] = []
      if (i < lines.length && lines[i].startsWith("|||||||")) {
        i++
        while (i < lines.length && !lines[i].startsWith("=======")) {
          base.push(lines[i])
          i++
        }
      }
      i++
      const theirs: string[] = []
      while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
        theirs.push(lines[i])
        i++
      }
      i++
      segs.push({
        type: "conflict",
        ours: ours.join("\n"),
        theirs: theirs.join("\n"),
        base: base.length ? base.join("\n") : undefined,
      })
    } else {
      buf.push(l)
      i++
    }
  }
  flush()
  return segs
}

export function ConflictView({ bottom, theme }: { bottom: number; theme: "light" | "dark" }) {
  const s = useGit()
  const t = useT()
  const c = s.conflict
  const segs = React.useMemo(() => {
    if (!c || c.loading) return []
    const src = c.diff3 && c.diff3.includes("|||||||") ? c.diff3 : c.working
    return src ? parseConflicts(src) : []
  }, [c?.working, c?.diff3, c?.loading])
  const conflictCount = React.useMemo(() => segs.filter((x) => x.type === "conflict").length, [segs])
  const [choices, setChoices] = React.useState<Record<number, "ours" | "theirs" | "both">>({})
  const [resultEditing, setResultEditing] = React.useState(false)
  const [resultText, setResultText] = React.useState("")
  const [showBase, setShowBase] = React.useState(false)
  React.useEffect(() => {
    setChoices({})
    setResultEditing(false)
    setShowBase(false)
  }, [c?.file])
  if (!c) return null

  const buildResult = () => {
    const parts: string[] = []
    let k = 0
    for (const seg of segs) {
      if (seg.type === "text") parts.push(seg.text)
      else {
        const ch = choices[k] || "both"
        parts.push(
          ch === "ours"
            ? seg.ours
            : ch === "theirs"
              ? seg.theirs
              : [seg.ours, seg.theirs].filter((x) => x !== "").join("\n"),
        )
        k++
      }
    }
    return parts.join("\n")
  }
  const allChosen = conflictCount === 0 || Array.from({ length: conflictCount }).every((_, i) => choices[i])
  const apply = () => {
    void store.resolveConflictContent(c.file, resultEditing ? resultText : buildResult())
  }

  return (
    <div className="dig-theme dig-diffarea" data-theme={theme} style={{ bottom }}>
      <div className="dig-diff__head">
        <Icon name="warning" size={15} style={{ color: "var(--danger)" }} />
        <span className="dig-diff__title" title={c.file}>
          {t("Resolve Conflicts")}: {c.file}
          {conflictCount ? ` · ${conflictCount}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="dig-btn" onClick={() => void store.resolveSide(c.file, "ours")}>
          {t("Accept Ours")}
        </button>
        <button type="button" className="dig-btn" onClick={() => void store.resolveSide(c.file, "theirs")}>
          {t("Accept Theirs")}
        </button>
        <button type="button" className="dig-btn" onClick={() => setShowBase((v) => !v)}>
          {t("Base")}
        </button>
        <button
          type="button"
          className="dig-btn"
          onClick={() => {
            setResultText(buildResult())
            setResultEditing(true)
          }}
        >
          {t("Edit Result…")}
        </button>
        <button
          type="button"
          className="dig-btn dig-btn--primary"
          disabled={!allChosen && !resultEditing}
          onClick={apply}
        >
          {t("Apply & Mark Resolved")}
        </button>
        <IconButton icon="close" title={t("Close")} onClick={() => store.closeConflict()} />
      </div>
      <div className="dig-diff__body">
        {c.loading ? (
          <div className="dig-empty">{t("Loading")}</div>
        ) : conflictCount === 0 ? (
          <div className="dig-empty" style={{ flexDirection: "column", gap: 8 }}>
            <span>{t("No conflict markers in the working file.")}</span>
            <button type="button" className="dig-btn" onClick={() => void store.resolveSide(c.file, "mark")}>
              {t("Mark Resolved")}
            </button>
          </div>
        ) : (
          <div className="dig-merge">
            {(() => {
              let k = 0
              return segs.map((seg, idx) => {
                if (seg.type === "text")
                  return (
                    <pre key={idx} className="dig-merge__text">
                      {seg.text}
                    </pre>
                  )
                const my = k++
                return (
                  <div key={idx} className="dig-merge__conflict">
                    <div className="dig-merge__cols">
                      <div className="dig-merge__pane dig-merge__pane--ours">
                        <div className="dig-merge__label">{t("Ours")}</div>
                        <pre>{seg.ours || " "}</pre>
                      </div>
                      {seg.base !== undefined ? (
                        <div className="dig-merge__pane dig-merge__pane--base">
                          <div className="dig-merge__label">{t("Base")}</div>
                          <pre>{seg.base || " "}</pre>
                        </div>
                      ) : null}
                      <div className="dig-merge__pane dig-merge__pane--theirs">
                        <div className="dig-merge__label">{t("Theirs")}</div>
                        <pre>{seg.theirs || " "}</pre>
                      </div>
                    </div>
                    <div className="dig-merge__actions">
                      {(["ours", "theirs", "both"] as const).map((ch) => (
                        <button
                          key={ch}
                          type="button"
                          className="dig-btn"
                          data-active={choices[my] === ch ? "true" : undefined}
                          onClick={() => setChoices((prev) => ({ ...prev, [my]: ch }))}
                        >
                          {ch === "ours" ? t("Ours") : ch === "theirs" ? t("Theirs") : t("Both")}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })
            })()}
          </div>
        )}
      </div>
      {showBase ? (
        <div className="dig-edit-overlay">
          <div className="dig-edit-overlay__bar">
            <span>
              {t("Base")}: {c.file}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="dig-btn" onClick={() => setShowBase(false)}>
              {t("Close")}
            </button>
          </div>
          <pre className="dig-merge__text" style={{ flex: 1, overflow: "auto", margin: 0 }}>
            {c.base || ""}
          </pre>
        </div>
      ) : null}
      {resultEditing ? (
        <div className="dig-edit-overlay">
          <div className="dig-edit-overlay__bar">
            <span>
              {t("Result")}: {c.file}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="dig-btn" onClick={() => setResultEditing(false)}>
              {t("Cancel")}
            </button>
            <button
              type="button"
              className="dig-btn dig-btn--primary"
              onClick={() => {
                void store.resolveConflictContent(c.file, resultText)
                setResultEditing(false)
              }}
            >
              {t("Apply & Mark Resolved")}
            </button>
          </div>
          <textarea
            className="dig-edit-overlay__text"
            value={resultText}
            spellCheck={false}
            onChange={(e) => setResultText(e.target.value)}
          />
        </div>
      ) : null}
    </div>
  )
}
