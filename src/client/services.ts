/** Late-bound DSH theme/locale services + resync helpers (handle cold-start ordering). */
import { setTheme } from './window'
import { setActiveLocale } from './lib/i18n'

let themeSvc: any = null
let localeSvc: any = null

export function installServices(ctx: any) {
  try { themeSvc = ctx.get?.('theme') ?? null } catch {}
  try { localeSvc = ctx.get?.('locale') ?? null } catch {}
}

export function syncTheme() {
  try {
    const scheme = themeSvc?.getTheme?.()?.active?.colorScheme
    if (scheme === 'light' || scheme === 'dark') setTheme(scheme)
  } catch {}
}

export function syncLocale() {
  try {
    const id = localeSvc?.getSnapshot?.().active ?? localeSvc?.getLocale?.().active
    if (id) setActiveLocale(id)
  } catch {}
}

export function syncAll() {
  syncTheme()
  syncLocale()
}
