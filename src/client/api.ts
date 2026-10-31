/** Connection/API helper for the panel. */

let connection: any = null

export function setConnection(next: any) {
  connection = next
}

export function hasConnection(): boolean {
  return !!connection?.rpc?.call
}

interface RpcError extends Error {
  code?: string
  details?: unknown
}

function makeError(error: any): RpcError {
  const e = new Error(error?.message || 'Git 调用失败') as RpcError
  e.code = error?.code
  e.details = error?.details
  return e
}

export async function rpc<T = unknown>(method: string, payload: unknown = {}, signal?: AbortSignal): Promise<T> {
  if (!connection?.rpc?.call) throw makeError({ code: 'idea-git/no-connection', message: '与 Host 的连接不可用' })
  const res = await connection.rpc.call('/api', 'idea-git', { method, payload }, signal)
  if (!res) throw makeError({ message: '空响应' })
  if (res.ok !== true) throw makeError(res.error)
  // The connection unwraps the HTTP envelope one level, so `res.value` is the
  // method's own value (e.g. a status object, or a { ok, output } result). Only
  // unwrap again if it really looks like an RPC reply ({ ok, value|error }) —
  // otherwise values like { ok:false, output } would be misread as an envelope.
  const inner: any = res.value
  if (inner && typeof inner === 'object' && typeof inner.ok === 'boolean' && ('value' in inner || 'error' in inner)) {
    if (inner.ok === true) return inner.value as T
    throw makeError(inner.error)
  }
  return inner as T
}
