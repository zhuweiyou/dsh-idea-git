/** Worktree view: list, add and remove git worktrees. */
import React from "react"
import { useGit, Icon, IconButton } from "../lib/ui"
import { useT } from "../lib/i18n"
import * as store from "../store"
import { askText } from "../lib/prompt"
import { openContextMenu } from "../lib/contextMenu"

export function WorktreeView() {
  const s = useGit()
  const t = useT()
  React.useEffect(() => {
    void store.loadWorktrees()
  }, [])
  const add = async () => {
    const p = await askText(t("New worktree path"))
    if (!p) return
    const b = (await askText(t("New branch name (optional, blank = detached)"))) || undefined
    void store.addWorktree(p, b)
  }
  return (
    <div className="dig-wt">
      <div className="dig-toolbar">
        <IconButton
          icon="refresh"
          title={t("Refresh")}
          onClick={() => void store.loadWorktrees()}
        />
        <button type="button" className="dig-btn" onClick={add}>
          ＋ {t("Add worktree…")}
        </button>
        <button
          type="button"
          className="dig-btn"
          onClick={() => {
            if (window.confirm(t("Prune stale worktree records?"))) void store.pruneWorktrees()
          }}
        >
          {t("Prune")}
        </button>
        <IconButton
          icon="refresh"
          title={t("Repair worktrees")}
          onClick={() => void store.repairWorktree([])}
        />
        <span style={{ flex: 1 }} />
        <span className="dig-toolbar__hint">{t("{n} worktrees", { n: s.worktrees.length })}</span>
      </div>
      <div className="dig-wt__list">
        {s.worktrees.length === 0 ? <div className="dig-empty">{t("No worktrees")}</div> : null}
        {s.worktrees.map((w) => (
          <div
            className="dig-wtrow"
            key={w.path}
            onContextMenu={(e) =>
              openContextMenu(e, [
                {
                  label: w.locked ? t("Unlock") : t("Lock"),
                  disabled: w.current,
                  run: () => void store.lockWorktree(w.path, !w.locked),
                },
                {
                  label: t("Move…"),
                  disabled: w.current,
                  run: async () => {
                    const to = await askText(t("Move worktree to"), w.path)
                    if (to) void store.moveWorktree(w.path, to)
                  },
                },
                { label: t("Repair link"), run: () => void store.repairWorktree([w.path]) },
                { separator: true },
                {
                  label: t("Remove worktree"),
                  danger: true,
                  disabled: w.current,
                  run: () => {
                    if (window.confirm(t("Remove this worktree?")))
                      void store.removeWorktree(w.path)
                  },
                },
              ])
            }
          >
            <Icon
              name="folder"
              size={14}
              style={{ color: w.current ? "var(--accent)" : "var(--fg-subtle)" }}
            />
            <div className="dig-wtrow__main">
              <div className="dig-wtrow__path" title={w.path}>
                {w.path}
              </div>
              <div className="dig-wtrow__meta">
                {w.branch || t("(detached)")}
                {w.locked ? " · " + t("locked") : ""}
                {w.bare ? " · " + t("bare") : ""}
              </div>
            </div>
            {w.current ? (
              <span className="dig-wtrow__badge">{t("current")}</span>
            ) : (
              <IconButton
                icon="trash"
                title={t("Remove worktree")}
                onClick={() => {
                  if (window.confirm(t("Remove this worktree?"))) void store.removeWorktree(w.path)
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
