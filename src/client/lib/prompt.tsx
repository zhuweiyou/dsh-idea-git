/** In-app text prompt using DSH Modal/Button primitives. */
import React from "react"
import { Modal, Button } from "@deepseek-ai/dsh-client-ui-primitives"
import { t } from "./i18n"
import { useDshTheme } from "../services"

interface Pending {
  title: string
  initial: string
  multiline: boolean
  resolve: (v: string | null) => void
}
let pending: Pending | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => { try { f() } catch {} })

export function askText(title: string, initial = ""): Promise<string | null> {
  return new Promise((resolve) => {
    pending = { title, initial, multiline: false, resolve }
    emit()
  })
}

export function askMultiline(title: string, initial = ""): Promise<string | null> {
  return new Promise((resolve) => {
    pending = { title, initial, multiline: true, resolve }
    emit()
  })
}

function finish(v: string | null) {
  const p = pending
  pending = null
  emit()
  p?.resolve(v)
}

export function PromptHost() {
  const theme = useDshTheme()
  const p = React.useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb) },
    () => pending,
  )
  const [value, setValue] = React.useState("")
  const ref = React.useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  React.useEffect(() => {
    if (p) {
      setValue(p.initial)
      setTimeout(() => { ref.current?.focus(); ref.current?.select() }, 0)
    }
  }, [p])
  if (!p) return null
  const ok = () => { if (value.trim()) finish(value.trim()) }
  return (
    <Modal
      open
      title={p.title}
      closeLabel={t("Cancel")}
      onClose={() => finish(null)}
      footer={
        <>
          <Button variant="outline" onClick={() => finish(null)}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!value.trim()} onClick={ok}>{t("OK")}</Button>
        </>
      }
    >
      <div className="dig-theme" data-theme={theme}>
      {p.multiline ? (
        <textarea
          ref={ref as any}
          className="dig-modal__input"
          style={{ width: "100%", height: 180, resize: "vertical" }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ok() }
          }}
        />
      ) : (
        <input
          ref={ref as any}
          className="dig-modal__input"
          style={{ width: "100%" }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ok() } }}
        />
      )}
      </div>
    </Modal>
  )
}
