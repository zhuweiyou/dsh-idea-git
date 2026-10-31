/** Incoming/Outgoing commits and Compare-branches commit lists (DSH Modal). */
import React from "react"
import { Modal, Button } from "@deepseek-ai/dsh-client-ui-primitives"
import { useGit } from "../lib/ui"
import { useT } from "../lib/i18n"
import * as store from "../store"

type C = { id: string; short: string; subject: string; author: string; date: number }

function CommitList({ items, empty }: { items: C[]; empty: string }) {
  if (!items.length) return <div className="dig-empty">{empty}</div>
  return (
    <div className="dig-commitlistdlg">
      {items.map((c) => (
        <div className="dig-commitlistdlg__row" key={c.id} title={c.id}>
          <span className="dig-commitlistdlg__sha">{c.short}</span>
          <span className="dig-commitlistdlg__subject">{c.subject}</span>
          <span className="dig-commitlistdlg__author">{c.author}</span>
        </div>
      ))}
    </div>
  )
}

export function IncomingOutgoingDialog() {
  const s = useGit()
  const t = useT()
  const d = s.incomingDialog
  if (!d) return null
  return (
    <Modal
      open
      title={t("Incoming / Outgoing")}
      closeLabel={t("Close")}
      onClose={() => store.closeIncomingOutgoing()}
      footer={
        <Button variant="outline" onClick={() => store.closeIncomingOutgoing()}>
          {t("Close")}
        </Button>
      }
    >
      {!d.upstream ? (
        <div className="dig-empty">{t("No upstream configured")}</div>
      ) : (
        <div className="dig-commitlists">
          <div className="dig-commitlists__col">
            <div className="dig-commitlists__title">
              {t("Incoming")} ({d.behind.length})
            </div>
            <CommitList items={d.behind} empty={t("Nothing to pull")} />
          </div>
          <div className="dig-commitlists__col">
            <div className="dig-commitlists__title">
              {t("Outgoing")} ({d.ahead.length})
            </div>
            <CommitList items={d.ahead} empty={t("Nothing to push")} />
          </div>
        </div>
      )}
    </Modal>
  )
}

export function CompareBranchesDialog() {
  const s = useGit()
  const t = useT()
  const d = s.compareDialog
  if (!d) return null
  return (
    <Modal
      open
      title={`${t("Compare")}: ${d.from} ↔ ${d.to}`}
      closeLabel={t("Close")}
      onClose={() => store.closeCompareCommits()}
      footer={
        <Button variant="outline" onClick={() => store.closeCompareCommits()}>
          {t("Close")}
        </Button>
      }
    >
      <div className="dig-commitlists">
        <div className="dig-commitlists__col">
          <div className="dig-commitlists__title">
            {d.from} ({d.left.length})
          </div>
          <CommitList items={d.left} empty={t("No commits")} />
        </div>
        <div className="dig-commitlists__col">
          <div className="dig-commitlists__title">
            {d.to} ({d.right.length})
          </div>
          <CommitList items={d.right} empty={t("No commits")} />
        </div>
      </div>
    </Modal>
  )
}
