/** Conflict hub: file table with ours/theirs status, accept actions, grouping and manual merge. */
import React from "react"
import { Modal, Button } from "@deepseek-ai/dsh-client-ui-primitives"
import { useGit } from "../lib/ui"
import { useT } from "../lib/i18n"
import * as store from "../store"
import { useDshTheme } from "../services"

export function MergeConflictsDialog() {
  const s = useGit()
  const t = useT()
  const theme = useDshTheme()
  const [groupByDir, setGroupByDir] = React.useState(false)
  const [selected, setSelected] = React.useState("")
  const conflicts = s.files.filter((f) => f.kind === "conflicted")
  React.useEffect(() => {
    if (!conflicts.some((f) => f.path === selected)) setSelected(conflicts[0]?.path || "")
  }, [s.files, selected])
  if (!s.mergeDialog) return null
  const oursName = s.info?.branch?.head || t("Yours")
  const theirsName = s.mergeSource || t("Theirs")
  const close = () => store.closeMergeDialog()
  const groups = (() => {
    if (!groupByDir) return [{ title: "", files: conflicts }]
    const map = new Map<string, typeof conflicts>()
    for (const f of conflicts) {
      const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : t("Root")
      if (!map.has(dir)) map.set(dir, [])
      map.get(dir)!.push(f)
    }
    return [...map.entries()].map(([title, files]) => ({ title, files }))
  })()
  const resolveSide = (path: string, side: "ours" | "theirs") => {
    void store.resolveConflict(path, side).then(() => store.refreshStatus())
  }
  return (
    <Modal
      open
      title={t("Resolve Conflicts")}
      closeLabel={t("Cancel")}
      className="dig-conflict-dialog"
      onClose={close}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            {t("Close")}
          </Button>
          <Button variant="outline" disabled={!conflicts.length} onClick={() => void store.resolveSimpleConflicts()}>
            {t("Resolve All Simple Conflicts")}
          </Button>
          <Button
            variant="outline"
            disabled={!selected}
            onClick={() => selected && store.openConflictFromMergeDialog(selected)}
          >
            {t("Resolve Manually")}
          </Button>
          <Button
            variant="primary"
            disabled={conflicts.length > 0}
            onClick={() => {
              close()
              void store.commitNow(false)
            }}
          >
            {t("Accept and Finish")}
          </Button>
        </>
      }
    >
      <div className="dig-theme" data-theme={theme}>
        <div className="dig-conflicttable__summary">
          {t("Merging {from} into {to}", { from: theirsName, to: oursName })}
        </div>
        <div className="dig-conflicttable__toolbar">
          <button
            type="button"
            className="dig-btn"
            disabled={!conflicts.length}
            onClick={() => void store.resolveSimpleConflicts()}
          >
            {t("Resolve All Simple Conflicts")}
          </button>
          <button type="button" className="dig-btn" onClick={() => setGroupByDir((v) => !v)}>
            {t("Group by directory")}
          </button>
        </div>
        <div className="dig-conflicttable__head">
          <span>{t("File")}</span>
          <span title={`${t("Yours")} (${oursName})`}>
            {t("Yours")} ({oursName})
          </span>
          <span title={`${t("Theirs")} (${theirsName})`}>
            {t("Theirs")} ({theirsName})
          </span>
          <span>{t("Manual")}</span>
        </div>
        <div className="dig-conflicttable__body">
          {conflicts.length ? (
            groups.map((group) => (
              <React.Fragment key={group.title || "all"}>
                {group.title ? <div className="dig-conflicttable__group">{group.title}</div> : null}
                {group.files.map((f) => (
                  <div
                    className="dig-conflicttable__row"
                    key={f.path}
                    data-selected={selected === f.path ? "true" : undefined}
                    onClick={() => setSelected(f.path)}
                    onDoubleClick={() => store.openConflictFromMergeDialog(f.path)}
                  >
                    <span className="dig-conflicttable__path" title={f.path}>
                      {f.path}
                    </span>
                    <span className="dig-conflicttable__cell">
                      {t("Modified")}{" "}
                      <button
                        type="button"
                        className="dig-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          resolveSide(f.path, "ours")
                        }}
                      >
                        {t("Accept")}
                      </button>
                    </span>
                    <span className="dig-conflicttable__cell">
                      {t("Modified")}{" "}
                      <button
                        type="button"
                        className="dig-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          resolveSide(f.path, "theirs")
                        }}
                      >
                        {t("Accept")}
                      </button>
                    </span>
                    <span className="dig-conflicttable__cell">
                      <button
                        type="button"
                        className="dig-btn dig-btn--primary"
                        onClick={(e) => {
                          e.stopPropagation()
                          store.openConflictFromMergeDialog(f.path)
                        }}
                      >
                        {t("Merge…")}
                      </button>
                    </span>
                  </div>
                ))}
              </React.Fragment>
            ))
          ) : (
            <div className="dig-empty">{t("No conflicts")}</div>
          )}
        </div>
        <div className="dig-conflicttable__foot">
          <span>{t("Unresolved {n} files", { n: conflicts.length })}</span>
        </div>
      </div>
    </Modal>
  )
}
