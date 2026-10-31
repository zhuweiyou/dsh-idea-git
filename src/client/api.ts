/** Connection/API helper for the panel. */
import { t } from "./lib/i18n"

let connection: any = null
let uiWorkspace: any = null

export function setConnection(next: any) {
  connection = next
}

export function setUiWorkspace(w: any) {
  uiWorkspace = w
}

export async function pickDirectory(): Promise<string | null> {
  try {
    return (await uiWorkspace?.pickDirectory?.()) ?? null
  } catch {
    return null
  }
}

export function hasConnection(): boolean {
  return !!connection?.rpc?.call
}

interface RpcError extends Error {
  code?: string
  details?: unknown
}

function makeError(error: any): RpcError {
  const e = new Error(error?.message || t("Git call failed")) as RpcError
  e.code = error?.code
  e.details = error?.details
  return e
}

export async function rpc<T = unknown>(
  method: string,
  payload: unknown = {},
  signal?: AbortSignal,
): Promise<T> {
  if (!connection?.rpc?.call)
    throw makeError({
      code: "idea-git/no-connection",
      message: t("Connection to the Host is unavailable."),
    })
  const res = await connection.rpc.call("/api", "idea-git", { method, payload }, signal)
  if (!res) throw makeError({ message: t("Empty response") })
  if (res.ok !== true) throw makeError(res.error)
  // The connection unwraps the HTTP envelope one level, so `res.value` is the
  // method's own value (e.g. a status object, or a { ok, output } result). Only
  // unwrap again if it really looks like an RPC reply ({ ok, value|error }) —
  // otherwise values like { ok:false, output } would be misread as an envelope.
  const inner: any = res.value
  if (
    inner &&
    typeof inner === "object" &&
    typeof inner.ok === "boolean" &&
    ("value" in inner || "error" in inner)
  ) {
    if (inner.ok === true) return inner.value as T
    throw makeError(inner.error)
  }
  return inner as T
}
