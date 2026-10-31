/** New tag dialog: name, annotated message, force overwrite, target commit. */
import React from "react"
import { Modal, Button } from "@deepseek-ai/dsh-client-ui-primitives"
import { useGit } from "../lib/ui"
import { useT } from "../lib/i18n"
import * as store from "../store"

export function TagDialog() {
  const s = useGit()
  const t = useT()
  const commit = s.tagDialogCommit
  const [name, setName] = React.useState("")
  const [message, setMessage] = React.useState("")
  const [force, setForce] = React.useState(false)
  React.useEffect(() => {
    if (commit) {
      setName("")
      setMessage("")
      setForce(false)
    }
  }, [commit])
  if (!commit) return null
  const close = () => store.closeTagDialog()
  const create = () => {
    if (!name.trim()) return
    void store.createTag(name.trim(), commit, message.trim() || undefined, force)
    close()
  }
  return (
    <Modal
      open
      title={t("New Tag")}
      closeLabel={t("Cancel")}
      onClose={close}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" disabled={!name.trim()} onClick={create}>
            {t("Create")}
          </Button>
        </>
      }
    >
      <div className="dig-tagdialog">
        <label className="dig-tagdialog__row">
          <span>{t("Tag name")}</span>
          <input className="dig-modal__input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="dig-tagdialog__row">
          <span>{t("Tag message (optional)")}</span>
          <textarea
            className="dig-modal__input"
            style={{ height: 100 }}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <label className="dig-tagdialog__check">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          <span>{t("Force overwrite if exists")}</span>
        </label>
        <div className="dig-tagdialog__target">
          {t("Target")}: {commit.slice(0, 7)}
        </div>
      </div>
    </Modal>
  )
}
