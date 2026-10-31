/** Patch preview before applying (files + stat). */
import React from "react"
import { Modal, Button } from "@deepseek-ai/dsh-client-ui-primitives"
import { useGit } from "../lib/ui"
import { useT } from "../lib/i18n"
import * as store from "../store"

export function PatchPreviewDialog() {
  const s = useGit()
  const t = useT()
  const p = s.patchPreview
  if (!p) return null
  return (
    <Modal
      open
      title={t("Apply Patch")}
      closeLabel={t("Cancel")}
      onClose={() => store.closePatchPreview()}
      footer={
        <>
          <Button variant="outline" onClick={() => store.closePatchPreview()}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!p.files.length || !!s.busy}
            onClick={() => void store.applyPreviewPatch()}
          >
            {t("Apply")}
          </Button>
        </>
      }
    >
      <div className="dig-patchpreview">
        {p.files.length ? (
          <div className="dig-patchpreview__files">
            {p.files.map((f) => (
              <div className="dig-patchpreview__row" key={f.path}>
                <span className="dig-patchpreview__path">{f.path}</span>
                <span className="dig-patchpreview__plus">+{f.added}</span>
                <span className="dig-patchpreview__minus">−{f.deleted}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="dig-empty">{t("Patch does not apply cleanly")}</div>
        )}
        <pre className="dig-patchpreview__stat">{p.stat}</pre>
      </div>
    </Modal>
  )
}
