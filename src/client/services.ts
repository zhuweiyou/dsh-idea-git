/** Late-bound DSH theme/locale services + resync helpers (handle cold-start ordering). */
import { setTheme } from "./window"
import { setActiveLocale } from "./lib/i18n"

let context: any = null
let themeSvc: any = null
let localeSvc: any = null

export function installServices(ctx: any) {
  context = ctx
  refreshServices()
}

function refreshServices() {
  try {
    themeSvc = context?.get?.("theme") ?? themeSvc
  } catch {}
  try {
    localeSvc = context?.get?.("locale") ?? localeSvc
  } catch {}
}

export function syncTheme() {
  refreshServices()
  try {
    const ov = localStorage.getItem("dig.themeOverride")
    if (ov === "light" || ov === "dark") {
      setTheme(ov)
      return
    }
  } catch {}
  try {
    const scheme = themeSvc?.getTheme?.()?.active?.colorScheme
    if (scheme === "light" || scheme === "dark") setTheme(scheme)
  } catch {}
}

export function syncLocale() {
  refreshServices()
  try {
    const ov = localStorage.getItem("dig.localeOverride")
    if (ov) {
      setActiveLocale(ov)
      return
    }
  } catch {}
  try {
    const id = localeSvc?.getSnapshot?.().active ?? localeSvc?.getLocale?.().active
    if (id) setActiveLocale(id)
  } catch {}
}

export function setThemeOverride(v: "" | "light" | "dark") {
  try {
    if (v) localStorage.setItem("dig.themeOverride", v)
    else localStorage.removeItem("dig.themeOverride")
  } catch {}
  syncTheme()
}

export function setLocaleOverride(v: "" | "zh" | "en") {
  try {
    if (v) localStorage.setItem("dig.localeOverride", v)
    else localStorage.removeItem("dig.localeOverride")
  } catch {}
  syncLocale()
}

export function syncAll() {
  syncTheme()
  syncLocale()
}
