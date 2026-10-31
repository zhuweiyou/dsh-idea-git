/** Branch/ref comparison: changed files on the left, diff on the right. */
import React from "react"
import { useGit, Icon, IconButton } from "../lib/ui"
import { useT } from "../lib/i18n"
import { computeRows } from "../lib/textdiff"
import * as store from "../store"

export function CompareView({ bottom, theme }: { bottom: number; theme: "light" | "dark" }) {
  const s = useGit()
  const t = useT()
  const c = s.compare
  const rows = React.useMemo(
    () => (c?.diff && !c.diff.loading ? computeRows(c.diff.oldText, c.diff.newText, "none") : []),
    [c],
  )
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState("")
  React.useEffect(() => {
    setEditing(false)
  }, [c?.sel, c?.to])
  if (!c) return null
  return (
    <div className="dig-theme dig-diffarea" data-theme={theme} style={{ bottom }}>
      <div className="dig-diff__head">
        <Icon name="diff" size={15} />
        <span className="dig-diff__title">
          {t("Compare")}: {c.from} ↔ {c.to}
        </span>
        <span style={{ flex: 1 }} />
        <span className="dig-diff__hint">{t("{n} files", { n: c.files.length })}</span>
        {c.to === "WORKTREE" && c.sel ? (
          <button
            type="button"
            className="dig-btn"
            onClick={() => {
              setDraft(c.diff?.newText || "")
              setEditing(true)
            }}
          >
            {t("Edit")}
          </button>
        ) : null}
        <IconButton icon="close" title={t("Close")} onClick={() => store.closeCompare()} />
      </div>
      <div className="dig-compare">
        <div className="dig-compare__files">
          {c.files.length === 0 && !c.loading ? <div className="dig-empty">{t("No differences")}</div> : null}
          {c.files.map((f) => {
            const color =
              f.kind === "added"
                ? "var(--vcs-added)"
                : f.kind === "deleted"
                  ? "var(--vcs-deleted)"
                  : "var(--vcs-modified)"
            const letter = f.kind === "added" ? "A" : f.kind === "deleted" ? "D" : f.kind === "renamed" ? "R" : "M"
            return (
              <div
                key={f.path}
                className="dig-compare__file"
                data-selected={c.sel === f.path ? "true" : undefined}
                onClick={() => void store.selectCompareFile(f.path)}
                title={f.path}
              >
                <span style={{ color, width: 12, flex: "none", fontFamily: "var(--font-mono)" }}>{letter}</span>
                <span className="dig-compare__fname">{f.path.split("/").pop()}</span>
                <span className="dig-compare__fdir">
                  {f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""}
                </span>
              </div>
            )
          })}
        </div>
        <div className="dig-compare__diff">
          {c.loading ? (
            <div className="dig-empty">{t("Loading")}</div>
          ) : !c.diff ? (
            <div className="dig-empty">{t("Select a file")}</div>
          ) : c.diff.loading ? (
            <div className="dig-empty">{t("Loading")}</div>
          ) : c.diff.kind === "image" ? (
            <div className="dig-imgdiff">
              <div className="dig-imgpane">
                <div className="dig-imgpane__label">{c.diff.oldLabel || c.from}</div>
                {c.diff.oldB64 ? (
                  <img
                    className="dig-imgpane__img"
                    src={`data:${c.diff.mime || "application/octet-stream"};base64,${c.diff.oldB64}`}
                    alt="old"
                  />
                ) : (
                  <div className="dig-empty">{t("No image")}</div>
                )}
              </div>
              <div className="dig-imgpane">
                <div className="dig-imgpane__label">{c.diff.newLabel || c.to}</div>
                {c.diff.newB64 ? (
                  <img
                    className="dig-imgpane__img"
                    src={`data:${c.diff.mime || "application/octet-stream"};base64,${c.diff.newB64}`}
                    alt="new"
                  />
                ) : (
                  <div className="dig-empty">{t("No image")}</div>
                )}
              </div>
            </div>
          ) : c.diff.kind === "binary" ? (
            <div className="dig-empty">{t("Binary file")}</div>
          ) : (
            <div className="dig-diff__split">
              {rows.map((r, i) => (
                <div key={i} className={"dig-dsrow dig-dsrow--" + r.kind}>
                  <span className="dig-dsrow__no">{r.oldNo ?? ""}</span>
                  <span className="dig-dsrow__cell dig-dsrow__cell--old">
                    {r.oldNo != null ? r.oldText || "\u00a0" : null}
                  </span>
                  <span className="dig-dsrow__no">{r.newNo ?? ""}</span>
                  <span className="dig-dsrow__cell dig-dsrow__cell--new">
                    {r.newNo != null ? r.newText || "\u00a0" : null}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {editing && c.sel ? (
        <div className="dig-edit-overlay">
          <div className="dig-edit-overlay__bar">
            <span>
              {t("Editing worktree file")}: {c.sel}
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
                void store.saveWorktreeFile(c.sel!, draft, false).then(() => store.selectCompareFile(c.sel!))
              }}
            >
              {t("Save")}
            </button>
            <button
              type="button"
              className="dig-btn dig-btn--primary"
              onClick={() => {
                setEditing(false)
                void store.saveWorktreeFile(c.sel!, draft, true).then(() => store.selectCompareFile(c.sel!))
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
