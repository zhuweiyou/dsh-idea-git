/** Searchable branch/tag/revision chooser (DSH Modal). */
import React from "react"
import { Modal, Button } from "@deepseek-ai/dsh-client-ui-primitives"
import { useGit } from "./ui"
import { useT } from "./i18n"

interface Req { title: string; resolve: (v: string | null) => void }
let pending: Req | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => { try { f() } catch {} })

export function chooseRef(title: string): Promise<string | null> {
  return new Promise((resolve) => {
    pending = { title, resolve: (v) => { pending = null; emit(); resolve(v) } }
    emit()
  })
}

export function RefChooserHost() {
  const s = useGit()
  const t = useT()
  const req = React.useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb) }, () => pending)
  const [q, setQ] = React.useState("")
  React.useEffect(() => { if (req) setQ("") }, [req])
  if (!req) return null
  const refs = [...s.branches.map((b) => b.name), ...s.tags].filter((n) => !q || n.toLowerCase().includes(q.toLowerCase()))
  return (
    <Modal
      open
      title={req.title}
      closeLabel={t("Cancel")}
      onClose={() => req.resolve(null)}
      footer={<Button variant="outline" onClick={() => req.resolve(null)}>{t("Cancel")}</Button>}
    >
      <div className="dig-refchooser">
        <input className="dig-modal__input" autoFocus placeholder={t("Search branches, tags or revisions")} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="dig-refchooser__list">
          {refs.map((r) => (
            <button key={r} type="button" className="dig-refchooser__row" onClick={() => req.resolve(r)}>{r}</button>
          ))}
          {!refs.length && q.trim() ? (
            <button type="button" className="dig-refchooser__row" onClick={() => req.resolve(q.trim())}>{t("Use revision")}: {q.trim()}</button>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
