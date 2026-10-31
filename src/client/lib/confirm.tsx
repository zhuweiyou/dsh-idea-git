/** DSH-native confirmation dialog (Modal + Button from ui primitives). */
import React from "react"
import { Modal, Button } from "@deepseek-ai/dsh-client-ui-primitives"
import { useT } from "./i18n"

interface Request {
  message: string
  confirmLabel?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}
let pending: Request | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => { try { f() } catch {} })

export function askConfirm(opts: { message: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    pending = { ...opts, resolve }
    emit()
  })
}

/** Fire-and-forget helper for `if (window.confirm(m)) run()` call sites. */
export function confirmThen(message: string, run: () => void, opts?: { confirmLabel?: string; danger?: boolean }) {
  void askConfirm({ message, ...opts }).then((ok) => { if (ok) run() })
}

export function ConfirmHost() {
  const t = useT()
  const isOpen = React.useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb) },
    () => !!pending,
  )
  if (!pending) return null
  const req = pending
  const done = (ok: boolean) => { const p = pending; pending = null; emit(); p?.resolve(ok) }
  return (
    <Modal
      open={!!isOpen}
      title={t("Confirm")}
      closeLabel={t("Cancel")}
      description={req.message}
      onClose={() => done(false)}
      footer={
        <>
          <Button variant="outline" onClick={() => done(false)}>{t("Cancel")}</Button>
          <Button variant="primary" onClick={() => done(true)}>{req.confirmLabel || t("OK")}</Button>
        </>
      }
    />
  )
}
