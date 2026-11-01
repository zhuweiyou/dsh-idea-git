/** IDEA-style merge conflicts dialog: file list, per-file accept side or open 3-way merge. */
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
  if (!s.mergeDialog) return null
  const conflicts = s.files.filter((f) => f.kind === "conflicted")
  const close = () => store.closeMergeDialog()
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
          <Button
            variant="outline"
            disabled={!conflicts.length}
            onClick={async () => {
              for (const f of conflicts) await store.resolveConflict(f.path, "ours")
              await store.refreshStatus()
            }}
          >
            {t("Accept All Ours")}
          </Button>
          <Button
            variant="primary"
            disabled={!conflicts.length}
            onClick={async () => {
              for (const f of conflicts) await store.resolveConflict(f.path, "theirs")
              await store.refreshStatus()
            }}
          >
            {t("Accept All Theirs")}
          </Button>
        </>
      }
    >
      <div className="dig-theme" data-theme={theme}>
        {!conflicts.length ? (
          <div className="dig-empty">{t("No conflicts")}</div>
        ) : (
          <div className="dig-conflicttable">
            <div className="dig-conflicttable__head">
              <span>{t("File")}</span>
              <span>{t("Ours")}</span>
              <span>{t("Theirs")}</span>
              <span>{t("Manual")}</span>
            </div>
            <div className="dig-conflicttable__body">
              {conflicts.map((f) => (
                <div className="dig-conflicttable__row" key={f.path}>
                  <span className="dig-conflicttable__path" title={f.path}>
                    {f.path}
                  </span>
                  <span className="dig-conflicttable__cell">
                    <button
                      type="button"
                      className="dig-btn"
                      onClick={() => void store.resolveConflict(f.path, "ours")}
                    >
                      {t("Ours")}
                    </button>
                  </span>
                  <span className="dig-conflicttable__cell">
                    <button
                      type="button"
                      className="dig-btn"
                      onClick={() => void store.resolveConflict(f.path, "theirs")}
                    >
                      {t("Theirs")}
                    </button>
                  </span>
                  <span className="dig-conflicttable__cell">
                    <button
                      type="button"
                      className="dig-btn dig-btn--primary"
                      onClick={() => {
                        close()
                        void store.openConflict(f.path)
                      }}
                    >
                      {t("Merge…")}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
