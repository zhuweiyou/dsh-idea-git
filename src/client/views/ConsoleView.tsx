/** Console view: the git command log captured by the Host. */
import React from "react"
import { useGit, IconButton } from "../lib/ui"
import { useT } from "../lib/i18n"
import * as store from "../store"

export function ConsoleView() {
  const s = useGit()
  const t = useT()
  const bodyRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    void store.loadConsole()
    const timer = setInterval(() => void store.loadConsole(), 1500)
    return () => clearInterval(timer)
  }, [])

  React.useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [s.consoleEntries.length])

  return (
    <div className="dig-console">
      <div className="dig-console__bar">
        <IconButton icon="refresh" title={t("Refresh")} onClick={() => void store.loadConsole()} />
        <span className="dig-toolbar__hint">{t("{n} commands", { n: s.consoleEntries.length })}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="dig-btn" onClick={() => void store.clearConsole()}>
          {t("Clear")}
        </button>
      </div>
      <div className="dig-console__body" ref={bodyRef}>
        {s.consoleEntries.length === 0 ? <div className="dig-empty">{t("No command output")}</div> : null}
        {s.consoleEntries.map((e) => (
          <div key={e.id}>
            <div className="dig-console__cmd">
              <span className="dig-console__time">
                [
                {new Date(e.at).toLocaleTimeString([], {
                  hour12: false,
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
                ]{" "}
              </span>
              $ {e.command}
            </div>
            {e.stdout ? <div className="dig-console__out">{e.stdout.trimEnd()}</div> : null}
            {e.stderr ? <div className="dig-console__err">{e.stderr.trimEnd()}</div> : null}
            {e.code !== 0 ? <div className="dig-console__err">{t("Exit code {code}", { code: e.code })}</div> : null}
          </div>
        ))}
      </div>
    </div>
  )
}
