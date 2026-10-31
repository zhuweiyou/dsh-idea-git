/**
 * dsh-idea-git — Client half.
 *
 * Registers the composer GIT button and the OpenIDEA-style bottom Git panel, wires
 * the Host connection, injects the vendored OpenIDEA stylesheet, and follows the
 * DSH theme (light/dark) via `theme/change`.
 */
import React from "react"
import "./theme/tokens.css"
import "./styles/app.css"
import { setConnection, setUiWorkspace } from "./api"
import { setActiveLocale } from "./lib/i18n"
import { installServices, syncAll } from "./services"
import * as store from "./store"
import { useWindow, getWindow, setTarget, openPanel, closePanel, setTheme } from "./window"
import { switchWorkspace } from "./workspaceState"
import { Panel, ViewBoundary } from "./Panel"
import { SettingsSection } from "./SettingsSection"
import { Icon } from "./lib/ui"

export const name = "idea-git-client"
export const inject = ["slots"]

function injectStyle(css: string): () => void {
  if (!css) return () => {}
  const el = document.createElement("style")
  el.setAttribute("data-dsh-idea-git", "")
  el.textContent = css
  document.head.appendChild(el)
  return () => {
    try {
      el.remove()
    } catch {}
  }
}

function collectedCss(): string {
  const arr = ((globalThis as any).__DIG_CSS__ as string[] | undefined) || []
  return arr.join("\n")
}

/* ------------------------------------------------------------------ */
/* GIT entry button (composer left toolbar — the red-box position)     */
/* ------------------------------------------------------------------ */
function resolveDirectory(props: any): string {
  try {
    const workspaces = props.useWorkspaces ? props.useWorkspaces((v: any) => v) : null
    const sessions = props.useSessions ? props.useSessions((v: any) => v) : null
    const ws = (workspaces?.items || []).find((x: any) =>
      (x.sessionIds || []).includes(props.sessionId),
    )
    return ws?.path || sessions?.byId?.[props.sessionId]?.cwd || ""
  } catch {
    return ""
  }
}

function registerTarget(sessionId: string | undefined, directory: string) {
  if (!sessionId) return
  const cur = getWindow().target
  if (cur && cur.sessionId === sessionId && cur.directory === directory) return
  setTarget({ sessionId, directory })
  void store.activate({ sessionId, directory })
}

function GitEntryButton(props: any) {
  const w = useWindow()
  const directory = resolveDirectory(props)
  React.useEffect(() => {
    syncAll()
    const ts = [0, 200, 800].map((d) => setTimeout(syncAll, d))
    return () => ts.forEach(clearTimeout)
  }, [])

  React.useEffect(() => {
    switchWorkspace(directory)
  }, [directory])

  React.useEffect(() => {
    if (!w.open) return
    if (!props.sessionId) return
    registerTarget(props.sessionId, directory)
  }, [w.open, props.sessionId, directory])

  const onClick = () => {
    if (w.open) {
      closePanel()
      return
    }
    registerTarget(props.sessionId, directory)
    openPanel()
  }

  return (
    <button
      type="button"
      className="dig-entry"
      data-active={w.open ? "true" : undefined}
      title="Git"
      aria-label="Git"
      aria-pressed={w.open}
      onClick={onClick}
    >
      <Icon name="git" size={16} />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */
export function apply(ctx: any) {
  // Acquire the connection through injection: the client connection is a service
  // registered by the connection package, not guaranteed visible via ctx.get.
  try {
    ctx.inject(["connection"], (scope: any) => {
      try {
        setConnection(scope.connection ?? scope.get?.("connection"))
      } catch {}
      try {
        setUiWorkspace(ctx.get?.("uiWorkspace"))
      } catch {}
    })
  } catch {}

  ctx.effect(() => injectStyle(collectedCss()), "idea-git: styles")

  installServices(ctx)
  syncAll()
  // Services may not be ready at activation on a cold start; retry briefly.
  for (const delay of [0, 150, 500, 1500, 3000]) setTimeout(syncAll, delay)

  const theme = (() => {
    try {
      return ctx.get("theme")
    } catch {
      return undefined
    }
  })()
  const applyTheme = (snap: any) => {
    const scheme = snap?.active?.colorScheme
    if (scheme === "light" || scheme === "dark") setTheme(scheme)
  }
  try {
    applyTheme(theme?.getTheme?.())
  } catch {}
  ctx.effect(() => {
    try {
      const off = ctx.on?.("theme/change", (snap: any) => applyTheme(snap))
      return () => {
        try {
          off?.()
        } catch {}
      }
    } catch {
      return () => {}
    }
  }, "idea-git: theme")

  const locale = (() => {
    try {
      return ctx.get("locale")
    } catch {
      return undefined
    }
  })()
  const applyLocale = (id: string | undefined) => {
    try {
      setActiveLocale(id)
    } catch {}
  }
  try {
    applyLocale(locale?.getSnapshot?.().active ?? locale?.getLocale?.().active)
  } catch {}
  ctx.effect(() => {
    try {
      const off = locale?.subscribe?.(() => {
        try {
          applyLocale(locale.getSnapshot().active)
        } catch {}
      })
      return () => {
        try {
          off?.()
        } catch {}
      }
    } catch {
      return () => {}
    }
  }, "idea-git: locale")

  ctx.slots.inject("conversation.input.left", () =>
    ctx.slots.register(
      { name: "conversation.input.left", id: "idea-git-entry", order: 41 },
      GitEntryButton,
    ),
  )
  const PanelSlot = () => (
    <ViewBoundary>
      <Panel />
    </ViewBoundary>
  )
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register({ name: "shell.overlay", id: "idea-git-window", order: 41 }, PanelSlot),
  )
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      { name: "settings.section", id: "idea-git-settings", order: 60, label: () => "IDEA Git" },
      SettingsSection,
    ),
  )
}
