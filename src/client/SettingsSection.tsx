/** Plugin settings: Git executable (editable), LFS, behavior notes. */
import React from "react"
import { useT } from "./lib/i18n"
import * as api from "./api"
import { useWindow } from "./window"
import { syncAll, setThemeOverride, setLocaleOverride } from "./services"

interface VersionInfo {
  found: boolean
  path?: string
  version?: string
}
interface LfsInfo {
  installed: boolean
  version?: string
}

export function SettingsSection() {
  const t = useT()
  const w = useWindow()
  const [info, setInfo] = React.useState<VersionInfo | null>(null)
  const [lfs, setLfs] = React.useState<LfsInfo | null>(null)
  const [pathInput, setPathInput] = React.useState("")
  const [saved, setSaved] = React.useState(false)
  const [lfsFiles, setLfsFiles] = React.useState<string[] | null>(null)
  const [autoFetch, setAutoFetch] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem("dig.autoFetch") === "1"
    } catch {
      return false
    }
  })
  const [combineStash, setCombineStash] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem("dig.combineStashShelf") === "1"
    } catch {
      return false
    }
  })
  const [themeOv, setThemeOv] = React.useState<string>(() => {
    try {
      return localStorage.getItem("dig.themeOverride") || ""
    } catch {
      return ""
    }
  })
  const [localeOv, setLocaleOv] = React.useState<string>(() => {
    try {
      return localStorage.getItem("dig.localeOverride") || ""
    } catch {
      return ""
    }
  })

  const loadVersion = React.useCallback(() => {
    api
      .rpc<VersionInfo>("gitVersion", {})
      .then(setInfo)
      .catch(() => setInfo({ found: false }))
  }, [])
  React.useEffect(() => {
    loadVersion()
    api
      .rpc<LfsInfo>("lfsInfo", {})
      .then(setLfs)
      .catch(() => setLfs({ installed: false }))
    api
      .rpc<{ gitPath?: string }>("getSettings", {})
      .then((s) => setPathInput(s.gitPath || ""))
      .catch(() => {})
    api
      .rpc<string[]>("lfsLsFiles", {})
      .then(setLfsFiles)
      .catch(() => setLfsFiles([]))
  }, [loadVersion])

  const save = async () => {
    try {
      await api.rpc("setSettings", { gitPath: pathInput.trim() })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      loadVersion()
    } catch {}
  }

  return (
    <div className="dig-theme dig-settings" data-theme={w.theme}>
      <h3 className="dig-settings__title">IDEA Git</h3>
      <p className="dig-settings__desc">
        {t(
          "IDEA Git shows the active workspace repository as a bottom panel. Open it from the Git button in the composer.",
        )}
      </p>
      <div className="dig-settings__row">
        <span className="dig-settings__label">{t("Git executable")}</span>
        <span className="dig-settings__value">
          {info === null ? t("Loading") : info.found ? `${info.path}  ·  ${info.version}` : t("Not found")}
        </span>
      </div>
      <div className="dig-settings__row dig-settings__row--edit">
        <span className="dig-settings__label">{t("Git executable path")}</span>
        <span className="dig-settings__value dig-settings__edit">
          <input
            className="dig-settings__input"
            placeholder="git"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
          />
          <button type="button" className="dig-btn" onClick={() => void save()}>
            {saved ? t("Saved") : t("Save")}
          </button>
        </span>
      </div>
      <div className="dig-settings__row">
        <span className="dig-settings__label">{t("Git LFS")}</span>
        <span className="dig-settings__value">
          {lfs === null ? t("Loading") : lfs.installed ? lfs.version || t("Installed") : t("Not found")}
        </span>
      </div>
      <div className="dig-settings__row">
        <span className="dig-settings__label">{t("LFS tracked files")}</span>
        <span className="dig-settings__value">
          {lfsFiles === null
            ? t("Loading")
            : lfsFiles.length === 0
              ? t("None")
              : `${lfsFiles.length} — ${lfsFiles.slice(0, 6).join(", ")}${lfsFiles.length > 6 ? " …" : ""}`}
        </span>
      </div>
      <div className="dig-settings__row">
        <span className="dig-settings__label">{t("Auto fetch")}</span>
        <span className="dig-settings__value">
          <label className="dig-settings-check">
            <input
              type="checkbox"
              checked={autoFetch}
              onChange={(e) => {
                const v = e.target.checked
                setAutoFetch(v)
                try {
                  localStorage.setItem("dig.autoFetch", v ? "1" : "0")
                } catch {}
              }}
            />
            <span>{t("Fetch every 2 minutes while panel is open")}</span>
          </label>
        </span>
      </div>
      <div className="dig-settings__row">
        <span className="dig-settings__label">{t("Repository")}</span>
        <span className="dig-settings__value">
          {t("Follows the active conversation workspace (including subdirectories).")}
        </span>
      </div>
      <div className="dig-settings__row">
        <span className="dig-settings__label">{t("Stash and Shelf")}</span>
        <span className="dig-settings__value">
          <label className="dig-settings-check">
            <input
              type="checkbox"
              checked={combineStash}
              onChange={(e) => {
                const v = e.target.checked
                setCombineStash(v)
                try {
                  localStorage.setItem("dig.combineStashShelf", v ? "1" : "0")
                } catch {}
              }}
            />
            <span>{t("Combine Stash and Shelf tabs")}</span>
          </label>
        </span>
      </div>
      <div className="dig-settings__row">
        <span className="dig-settings__label">{t("Theme")}</span>
        <span className="dig-settings__value">
          <select
            className="dig-settings__select"
            value={themeOv}
            onChange={(e) => {
              const v = e.target.value
              setThemeOv(v)
              setThemeOverride(v as "" | "light" | "dark")
              syncAll()
            }}
          >
            <option value="">{t("Follow DSH")}</option>
            <option value="light">{t("Light")}</option>
            <option value="dark">{t("Dark")}</option>
          </select>
        </span>
      </div>
      <div className="dig-settings__row">
        <span className="dig-settings__label">{t("Language")}</span>
        <span className="dig-settings__value">
          <select
            className="dig-settings__select"
            value={localeOv}
            onChange={(e) => {
              const v = e.target.value
              setLocaleOv(v)
              setLocaleOverride(v as "" | "zh" | "en")
              syncAll()
            }}
          >
            <option value="">{t("Follow DSH")}</option>
            <option value="zh">{t("Simplified Chinese")}</option>
            <option value="en">English</option>
          </select>
        </span>
      </div>
    </div>
  )
}
