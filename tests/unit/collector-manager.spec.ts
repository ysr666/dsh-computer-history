import { PassThrough } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it } from 'vitest'
import { CollectorManager } from '../../src/host/collector/index.js'

describe('collector manager lifecycle', () => {
  it('owns stdio and escalates shutdown through managed subprocess', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    let terminated = false
    let waits = 0
    const writes: string[] = []
    stdin.on('data', chunk => { writes.push(String(chunk)) })

    const handle: SubprocessHandle = {
      stdin,
      stdout,
      stderr: undefined,
      control: undefined,
      collected: {},
      done: new Promise(() => {}),
      terminate() { terminated = true },
      async waitForExit() {
        waits += 1
        return waits > 1
      },
    }

    const ctx = {
      subprocess: {
        spawn: () => handle,
      },
    } as unknown as Context

    const manager = new CollectorManager(ctx, {
      executable: '/collector',
      cwd: '/tmp',
      graceMs: 10,
      onMessage: () => {},
    })

    manager.start()
    await manager.stop('plugin-dispose')

    expect(writes.join('')).toContain('"type":"shutdown"')
    expect(terminated).toBe(true)
    expect(waits).toBe(2)
  })
})
