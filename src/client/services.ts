/** Late-bound DSH theme/locale services + resync helpers (handle cold-start ordering). */
import React from "react"
import { setTheme } from "./window"
import { setActiveLocale } from "./lib/i18n"

let context: any = null
let themeSvc: any = null
let localeSvc: any = null

let dshTheme: "light" | "dark" = "dark"
const dshThemeSubs = new Set<() => void>()
function setDshTheme(v: "light" | "dark") {
  if (dshTheme === v) return
  dshTheme = v
  dshThemeSubs.forEach((f) => {
    try {
      f()
    } catch {}
  })
}
export function useDshTheme(): "light" | "dark" {
  return React.useSyncExternalStore(
    (cb) => {
      dshThemeSubs.add(cb)
      return () => dshThemeSubs.delete(cb)
    },
    () => dshTheme,
  )
}

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
  let scheme: "light" | "dark" | undefined
  try {
    const v = themeSvc?.getTheme?.()?.active?.colorScheme
    if (v === "light" || v === "dark") scheme = v
  } catch {}
  if (scheme) setDshTheme(scheme)
  let ov: string | null = null
  try {
    ov = localStorage.getItem("dig.themeOverride")
  } catch {}
  if (ov === "light" || ov === "dark") setTheme(ov)
  else if (scheme) setTheme(scheme)
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
