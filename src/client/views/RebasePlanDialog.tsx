/** Interactive rebase plan dialog (port of OpenIDEA rebasePlan), using DSH Modal. */
import React from "react"
import { Modal, Button } from "@deepseek-ai/dsh-client-ui-primitives"
import { useGit } from "../lib/ui"
import { useT } from "../lib/i18n"
import * as store from "../store"

const ACTIONS = ["pick", "reword", "squash", "fixup", "drop"] as const

export function RebasePlanDialog() {
  const s = useGit()
  const t = useT()
  const p = s.rebasePlan
  if (!p) return null
  const label = (a: string) =>
    a === "pick"
      ? t("Pick")
      : a === "reword"
        ? t("Reword")
        : a === "squash"
          ? t("Squash")
          : a === "fixup"
            ? t("Fixup")
            : t("Drop")
  return (
    <Modal
      open
      title={t("Interactive Rebase")}
      closeLabel={t("Cancel")}
      onClose={() => store.closeRebasePlan()}
      footer={
        <>
          <Button variant="outline" onClick={() => store.closeRebasePlan()}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" disabled={s.busy} onClick={() => void store.runRebasePlan()}>
            {t("Run")}
          </Button>
        </>
      }
    >
      <div className="dig-rebase-dialog__hint">
        {t("Oldest first. Drag not supported; choose an action per commit.")}
      </div>
      <div className="dig-rebase-dialog__list">
        {p.rows.map((r, i) => (
          <div
            className="dig-rebase-row"
            key={r.commit}
            draggable
            onDragStart={(e) => {
              try {
                e.dataTransfer.setData("text/x-rebase-row", String(i))
                e.dataTransfer.effectAllowed = "move"
              } catch {}
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("text/x-rebase-row")) e.preventDefault()
            }}
            onDrop={(e) => {
              const from = Number(e.dataTransfer.getData("text/x-rebase-row"))
              if (!Number.isNaN(from)) store.moveRebaseRow(from, i)
            }}
          >
            <select
              className="dig-rebase-row__action"
              value={r.action}
              onChange={(e) => store.setRebaseRow(i, { action: e.target.value as any })}
            >
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {label(a)}
                </option>
              ))}
            </select>
            <span className="dig-rebase-row__sha">{r.short}</span>
            {r.action === "reword" ? (
              <input
                className="dig-rebase-row__msg"
                value={r.message}
                onChange={(e) => store.setRebaseRow(i, { message: e.target.value })}
              />
            ) : (
              <span className="dig-rebase-row__summary" title={r.summary}>
                {r.summary}
              </span>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}
