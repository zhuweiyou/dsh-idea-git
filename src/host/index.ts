/**
 * dsh-idea-git — Host half.
 *
 * Registers the browser RPC endpoint used by the OpenIDEA-style Git panel. Git
 * work is performed by spawning the local `git` executable inside the session's
 * workspace directory; the repository root is discovered with
 * `git rev-parse --show-toplevel`, which also resolves a workspace that is only
 * a subdirectory of a larger repository.
 */
export const name = 'idea-git'

/** Optional services resolved dynamically so a headless profile still activates. */
export const inject: string[] = []

const RPC_PATH = '/api/idea-git'

export function apply(ctx: any) {
  const logger = ctx.logger ?? console
  ctx.inject(['connection'], (scope: any) => {
    const connection = scope.get ? scope.get('connection') : scope.connection
    if (!connection || typeof connection.fetch?.register !== 'function') {
      logger.warn?.('[idea-git] connection.fetch unavailable; RPC endpoint not registered')
      return
    }
    connection.fetch.register({
      path: RPC_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request: any) {
        if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })
        let message: any
        try {
          message = await request.json()
        } catch {
          return Response.json({ type: 'server-response', rpcId: 'invalid', result: { ok: false, error: { code: 'idea-git/bad-request', message: 'Body is not JSON' } } })
        }
        const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid'
        const call = message?.payload
        if (!call || typeof call.method !== 'string') {
          return Response.json({ type: 'server-response', rpcId, result: { ok: false, error: { code: 'idea-git/bad-request', message: 'Missing method' } } })
        }
        try {
          const { dispatch } = await import('./rpc.js')
          const result = await dispatch(ctx, call.method, call.payload ?? {}, request.signal)
          const safe = result && (result as any).ok === false
            ? { ...(result as any), error: { ...(result as any).error, details: (result as any).error?.details ?? {} } }
            : result
          return Response.json({ type: 'server-response', rpcId, result: safe })
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error)
          logger.warn?.(`[idea-git] ${call.method} failed: ${text}`)
          return Response.json({ type: 'server-response', rpcId, result: { ok: false, error: { code: 'idea-git/handler-failed', message: text } } })
        }
      },
    })
    logger.info?.(`[idea-git] RPC endpoint registered at ${RPC_PATH}`)
  })
  logger.info?.('[idea-git] host ready')
}
