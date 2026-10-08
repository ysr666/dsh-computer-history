import { describe, expect, it } from 'vitest'
import { connectCdp, initializeCdpSession } from '../../scripts/product-journey-cdp.mjs'

class FakeWebSocket extends EventTarget {
  static last: FakeWebSocket
  readyState = 0
  sent: Array<{ id: number, method: string }> = []
  constructor(_url: string) {
    super()
    FakeWebSocket.last = this
  }
  send(payload: string) {
    this.sent.push(JSON.parse(payload))
  }
  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }
  reply(id: number, result: unknown) {
    this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ id, result }),
    }))
  }
  close() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

describe('product journey CDP watchdogs', () => {
  it('fails a connection that never opens instead of hanging', async () => {
    await expect(connectCdp('ws://test', {
      WebSocketImpl: FakeWebSocket,
      connectTimeoutMs: 15,
    })).rejects.toThrow('handshake timed out')
  })

  it('fails a command when Chrome stops responding', async () => {
    const sessionPromise = connectCdp('ws://test', {
      WebSocketImpl: FakeWebSocket,
      commandTimeoutMs: 15,
    })
    FakeWebSocket.last.open()
    const session = await sessionPromise
    await expect(session.send('Runtime.evaluate')).rejects.toThrow(
      'Chrome CDP Runtime.evaluate timed out',
    )
    session.ws.close()
  })

  it('accepts successful replies and rejects a closed socket immediately', async () => {
    const sessionPromise = connectCdp('ws://test', {
      WebSocketImpl: FakeWebSocket,
      commandTimeoutMs: 500,
    })
    FakeWebSocket.last.open()
    const session = await sessionPromise
    const first = session.send('Page.enable')
    const id = FakeWebSocket.last.sent[0]?.id
    expect(id).toBeDefined()
    FakeWebSocket.last.reply(id!, { ok: true })
    await expect(first).resolves.toEqual({ ok: true })
    const second = session.send('Runtime.evaluate')
    session.ws.close()
    await expect(second).rejects.toThrow('WebSocket closed')
    await expect(session.send('Page.reload')).rejects.toThrow('not open')
  })
})


describe('CDP release startup recovery', () => {
  it('retries a page target that closes before Page.enable completes', async () => {
    let connections = 0
    const retries: number[] = []
    const session = await initializeCdpSession(
      async () => 'ws://chromium-page',
      {
        delayMs: 1,
        connectImpl: async () => {
          connections += 1
          const connection = connections
          const ws = new FakeWebSocket('ws://chromium-page')
          return {
            ws,
            send: async (method: string) => {
              if (connection === 1) {
                throw new Error('Chrome CDP WebSocket closed (code=1006)')
              }
              return { method }
            },
          }
        },
        onRetry(attempt: number) { retries.push(attempt) },
      },
    )
    expect(connections).toBe(2)
    expect(retries).toEqual([1])
    await expect(session.send('Page.captureScreenshot')).resolves.toEqual({
      method: 'Page.captureScreenshot',
    })
    session.ws.close()
  })

  it('fails after a fixed number of missing page targets, without an infinite loop', async () => {
    let attempts = 0
    await expect(initializeCdpSession(async () => {
      attempts += 1
      throw new Error('Chrome has no CDP page target yet')
    }, {
      attempts: 3,
      delayMs: 1,
    })).rejects.toThrow('failed after 3 bounded attempts')
    expect(attempts).toBe(3)
  })
})
