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

  it('stays up when a dead collector cannot be told the new policy', async () => {
    // Measured 2026-10-05 on a CLI-managed profile: the collector exited, `applyPolicyNow` then reached for it,
    // the guard in `send` threw `collector is not writable`, and that error escaped the plugin's start-up as
    // `dsh: fatal load failure` - the whole Host refused to start because one collector was gone. The design
    // says a collector that cannot be reached is a named degraded state with the Host still up.
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    let exit: () => void = () => {}
    const done = new Promise<{ exitCode: number | null, signal: NodeJS.Signals | null }>(resolve => {
      exit = () => resolve({ exitCode: 0, signal: null })
    })
    const handle: SubprocessHandle = {
      stdin,
      stdout,
      stderr: undefined,
      control: undefined,
      collected: {},
      done,
      terminate() {},
      async waitForExit() { return true },
    }
    const ctx = { subprocess: { spawn: () => handle } }
    const manager = new CollectorManager(ctx as never, {
      executable: '/collector',
      cwd: '/tmp',
      graceMs: 10,
      onMessage: () => {},
    })
    manager.start()
    stdout.write(`${JSON.stringify({
      v: 1, type: 'hello', collectorSession: 'dead-one', collectorVersion: '0.1.0',
      platform: 'darwin', arch: 'arm64', capabilities: ['app-focus'],
    })}\n`)
    await new Promise(resolve => setTimeout(resolve, 20))
    // The collector exits: this is the state production was in.
    exit()
    await new Promise(resolve => setTimeout(resolve, 30))
    const policy = { revision: 1, mode: 'include-only' as const, updatedAtMs: 1, rules: [] }
    await expect(manager.applyPolicy(policy)).resolves.toBeUndefined()
    expect(manager.snapshot().state?.state).toBe('degraded')
    await manager.stop('plugin-dispose')
  })
})

/**
 * A collector that starts and then says nothing, which is what the Windows machine showed: the process is spawned
 * (sampled at +17.35s) and no hello ever reaches the Host. Sampling once is not enough to judge it - every timeout
 * writes a named state and every spawn used to clear it, so a snapshot taken at the wrong moment reads as silence.
 */
function silentHandle(waitForExit: () => Promise<boolean>): SubprocessHandle {
  return {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: undefined,
    control: undefined,
    collected: {},
    done: new Promise(() => {}),
    terminate() {},
    waitForExit,
  }
}

function managerFor(handle: SubprocessHandle, helloTimeoutMs: number, restartDelaysMs?: readonly number[]) {
  const ctx = { subprocess: { spawn: () => handle } } as unknown as Context
  return new CollectorManager(ctx, {
    executable: '/collector-that-never-speaks',
    cwd: '/tmp',
    helloTimeoutMs,
    ...(restartDelaysMs ? { restartDelaysMs } : {}),
    onMessage: () => {},
    onUnexpectedExit: () => {},
  })
}

describe('a collector that never says hello', () => {
  it('ends in a named degraded state rather than in silence', async () => {
    const manager = managerFor(silentHandle(async () => true), 120)
    manager.start()
    await new Promise(resolve => setTimeout(resolve, 400))
    const snapshot = manager.snapshot()
    expect(snapshot.state?.state).toBe('degraded')
    expect(snapshot.state?.reason).toBe('hello-timeout')
    await manager.stop('plugin-dispose')
  })

  it('keeps a named reason across restarts instead of going silent again', async () => {
    const manager = managerFor(silentHandle(async () => true), 80, [40])
    manager.start()
    await new Promise(resolve => setTimeout(resolve, 600))
    const snapshot = manager.snapshot()
    expect(snapshot.state?.state).toBe('degraded')
    expect(snapshot.state?.reason).toBeDefined()
    await manager.stop('plugin-dispose')
  })

})
