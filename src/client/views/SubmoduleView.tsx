/** Submodules view: list submodules with state, update one or all. */
import React from "react"
import { useGit, Icon, IconButton } from "../lib/ui"
import { useT } from "../lib/i18n"
import * as store from "../store"

export function SubmoduleView() {
  const s = useGit()
  const t = useT()
  React.useEffect(() => {
    void store.loadSubmodules()
  }, [])
  const color = (st: string) =>
    st === "conflict"
      ? "var(--danger)"
      : st === "modified"
        ? "var(--vcs-modified)"
        : st === "uninitialized"
          ? "var(--fg-subtle)"
          : "var(--vcs-added)"
  const label = (st: string) =>
    st === "conflict"
      ? t("Conflict")
      : st === "modified"
        ? t("Modified")
        : st === "uninitialized"
          ? t("Uninitialized")
          : t("Up to date")
  return (
    <div className="dig-wt">
      <div className="dig-toolbar">
        <IconButton
          icon="refresh"
          title={t("Refresh")}
          onClick={() => void store.loadSubmodules()}
        />
        <button type="button" className="dig-btn" onClick={() => void store.updateSubmodule()}>
          {t("Update All")}
        </button>
        <span style={{ flex: 1 }} />
        <span className="dig-toolbar__hint">{t("{n} submodules", { n: s.submodules.length })}</span>
      </div>
      <div className="dig-wt__list">
        {s.submodules.length === 0 ? <div className="dig-empty">{t("No submodules")}</div> : null}
        {s.submodules.map((m) => (
          <div className="dig-wtrow" key={m.path}>
            <Icon name="folder" size={14} style={{ color: "var(--fg-subtle)" }} />
            <div className="dig-wtrow__main">
              <div className="dig-wtrow__path" title={m.path}>
                {m.path}
              </div>
              <div className="dig-wtrow__meta">
                {label(m.state)}
                {m.describe ? " · " + m.describe : ""} · {m.sha.slice(0, 7)}
              </div>
            </div>
            <span className="dig-wtrow__badge" style={{ color: color(m.state) }}>
              {label(m.state)}
            </span>
            <button
              type="button"
              className="dig-btn"
              onClick={() => void store.updateSubmodule(m.path)}
            >
              {t("Update")}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
