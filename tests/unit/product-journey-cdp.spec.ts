import { describe, expect, it } from 'vitest'
import { connectCdp } from '../../scripts/product-journey-cdp.mjs'

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
