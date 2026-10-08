/**
 * Bounded Chrome DevTools Protocol transport used only by the release product
 * journey. Chrome/DSH can stop replying without closing a WebSocket; without
 * both timeouts the GitHub release runner can hang until manually cancelled.
 */
export function connectCdp(
  url,
  {
    WebSocketImpl = WebSocket,
    connectTimeoutMs = 10_000,
    commandTimeoutMs = 15_000,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(url)
    const pending = new Map()
    let id = 0
    let connected = false
    let settled = false

    const rejectPending = error => {
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(error)
      }
      pending.clear()
    }
    const failBeforeOpen = error => {
      if (settled) return
      settled = true
      clearTimeout(connectTimer)
      reject(error)
    }
    const connectTimer = setTimeout(() => {
      failBeforeOpen(new Error(
        'Chrome CDP WebSocket handshake timed out after '
          + connectTimeoutMs + 'ms',
      ))
      ws.close()
    }, connectTimeoutMs)

    ws.addEventListener('message', event => {
      let message
      try {
        message = JSON.parse(String(event.data))
      } catch {
        rejectPending(new Error('Chrome CDP returned invalid JSON'))
        return
      }
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      clearTimeout(waiter.timer)
      if (message.error) {
        waiter.reject(new Error(JSON.stringify(message.error)))
      } else {
        waiter.resolve(message.result)
      }
    })
    ws.addEventListener('open', () => {
      if (settled) return
      connected = true
      settled = true
      clearTimeout(connectTimer)
      const send = (method, params = {}) => new Promise((res, rej) => {
        if (ws.readyState !== 1) {
          rej(new Error('Chrome CDP WebSocket is not open (' + method + ')'))
          return
        }
        const callId = ++id
        const timer = setTimeout(() => {
          pending.delete(callId)
          rej(new Error(
            'Chrome CDP ' + method + ' timed out after '
              + commandTimeoutMs + 'ms',
          ))
        }, commandTimeoutMs)
        pending.set(callId, { resolve: res, reject: rej, timer })
        try {
          ws.send(JSON.stringify({ id: callId, method, params }))
        } catch (error) {
          clearTimeout(timer)
          pending.delete(callId)
          rej(error)
        }
      })
      resolve({ ws, send })
    })
    ws.addEventListener('error', () => {
      const error = new Error('Chrome CDP WebSocket error')
      if (!connected) failBeforeOpen(error)
      rejectPending(error)
    })
    ws.addEventListener('close', event => {
      const code = Number.isInteger(event.code) ? event.code : 'unknown'
      const error = new Error('Chrome CDP WebSocket closed (code=' + code + ')')
      if (!connected) failBeforeOpen(error)
      rejectPending(error)
    })
  })
}

/** Retry only page-target discovery and CDP initialisation. Product assertions are
 * never retried: a genuine UI failure must still fail the release gate. */
export async function initializeCdpSession(
  getTargetUrl,
  {
    connectImpl = connectCdp,
    attempts = 4,
    delayMs = 750,
    onRetry = () => {},
  } = {},
) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error('CDP initialisation requires at least one attempt')
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let session
    try {
      const url = await getTargetUrl()
      session = await connectImpl(url)
      await session.send('Page.enable')
      await session.send('Runtime.enable')
      return session
    } catch (error) {
      try { session?.ws.close() } catch { /* already disconnected */ }
      if (attempt === attempts) {
        throw new Error(
          'Chrome CDP initialisation failed after ' + attempts
            + ' bounded attempts: ' + (error?.message || error),
        )
      }
      onRetry(attempt, error)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  throw new Error('Chrome CDP initialisation unexpectedly exhausted')
}
