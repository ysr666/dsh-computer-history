import { PassThrough } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it } from 'vitest'
import { CollectorManager } from '../../src/host/collector/index.js'

describe('collector provenance is bound to hello.platform', () => {
  function protocolManager(
    delivered: Array<unknown>,
  ): { manager: CollectorManager; stdout: PassThrough } {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const handle: SubprocessHandle = {
      stdin,
      stdout,
      stderr: undefined,
      control: undefined,
      collected: {},
      done: new Promise(() => {}),
      terminate() {},
      async waitForExit() { return true },
    }
    const ctx = {
      subprocess: { spawn: () => handle },
    } as unknown as Context
    return {
      stdout,
      manager: new CollectorManager(ctx, {
        executable: '/collector',
        cwd: '/tmp',
        restartOnCrash: false,
        onMessage: message => { delivered.push(message) },
      }),
    }
  }

  const observation = (
    session: string,
    provider?: 'macos-ax' | 'windows-uia' | 'at-spi',
  ) => ({
    v: 1,
    type: 'observation',
    collectorSession: session,
    seq: 1,
    observedAtMs: 1_000,
    app: { pid: 1, bundleId: 'com.microsoft.VSCode' },
    privacy: { secure: false, protected: false },
    source: {
      adapter: 'vscode',
      ...(provider === undefined ? {} : { provider }),
    },
  })

  it('fills missing legacy provenance from the collector hello platform', async () => {
    const cases = [
      ['darwin', 'macos-ax'],
      ['win32', 'windows-uia'],
      ['linux', 'at-spi'],
    ] as const

    for (const [platform, provider] of cases) {
      const delivered: Array<unknown> = []
      const { manager, stdout } = protocolManager(delivered)
      manager.start()
      stdout.write(JSON.stringify({
        v: 1,
        type: 'hello',
        collectorSession: `legacy-${platform}`,
        collectorVersion: '0.1.0',
        platform,
        arch: 'arm64',
        capabilities: [],
      }) + '\n')
      stdout.write(JSON.stringify(
        observation(`legacy-${platform}`),
      ) + '\n')
      // oxlint-disable-next-line no-await-in-loop -- each manager has an independent ordered processing chain
      await new Promise(resolve => setTimeout(resolve, 0))

      const stored = delivered.find(
        (message): message is {
          type: 'observation'
          source: { provider?: string }
        } => (
          typeof message === 'object'
          && message !== null
          && 'type' in message
          && message.type === 'observation'
        ),
      )
      expect(stored?.source.provider).toBe(provider)
      // oxlint-disable-next-line no-await-in-loop -- shut each independent manager down before the next case
      await manager.stop('plugin-dispose')
    }
  })

  it('refuses explicit provenance that contradicts hello.platform', async () => {
    const delivered: Array<unknown> = []
    const { manager, stdout } = protocolManager(delivered)
    manager.start()
    stdout.write(JSON.stringify({
      v: 1,
      type: 'hello',
      collectorSession: 'win-session',
      collectorVersion: '0.1.0',
      platform: 'win32',
      arch: 'x64',
      capabilities: [],
    }) + '\n')
    stdout.write(JSON.stringify(
      observation('win-session', 'at-spi'),
    ) + '\n')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(delivered.some(message =>
      typeof message === 'object'
      && message !== null
      && 'type' in message
      && message.type === 'observation',
    )).toBe(false)
    expect(manager.snapshot().state).toMatchObject({
      state: 'degraded',
      reason: 'protocol-error',
    })
    await manager.stop('plugin-dispose')
  })
})

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

/**
 * The Host on Windows spawned a collector that never spoke, and the state could not say whether a byte had arrived.
 * These three cases are the three worlds that used to share one name.
 */
describe('a collector that says nothing, and what the manager saw', () => {
  function managerWith(handle: SubprocessHandle, helloTimeoutMs: number) {
    const ctx = { subprocess: { spawn: () => handle } } as unknown as Context
    return new CollectorManager(ctx, {
      executable: '/collector',
      cwd: '/tmp',
      helloTimeoutMs,
      onMessage: () => {},
      onUnexpectedExit: () => {},
    })
  }

  it('names a missing stdin rather than only throwing it', () => {
    const handle = {
      stdin: undefined,
      stdout: new PassThrough(),
      stderr: undefined,
      control: undefined,
      collected: {},
      done: new Promise(() => {}),
      terminate() {},
      async waitForExit() { return true },
    } as unknown as SubprocessHandle
    const manager = managerWith(handle, 5000)
    expect(() => manager.start()).toThrow(/piped stdio/)
    expect(manager.snapshot().state?.state).toBe('degraded')
    expect(manager.snapshot().state?.reason).toBe('collector-stdio-missing')
  })

  it('says the collector spoke without a hello when bytes arrived but nothing parsed', async () => {
    const stdout = new PassThrough()
    const handle: SubprocessHandle = {
      stdin: new PassThrough(),
      stdout,
      stderr: undefined,
      control: undefined,
      collected: {},
      done: new Promise(() => {}),
      terminate() {},
      async waitForExit() { return true },
    }
    const manager = managerWith(handle, 120)
    manager.start()
    stdout.write('not a protocol line at all')
    await new Promise(resolve => setTimeout(resolve, 400))
    const state = manager.snapshot().state
    expect(state?.state).toBe('degraded')
    expect(state?.reason).toBe('collector-spoke-without-hello')
    await manager.stop('plugin-dispose')
  })

  it('keeps hello-timeout for a collector that said nothing at all', async () => {
    const handle: SubprocessHandle = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: undefined,
      control: undefined,
      collected: {},
      done: new Promise(() => {}),
      terminate() {},
      async waitForExit() { return true },
    }
    const manager = managerWith(handle, 120)
    manager.start()
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(manager.snapshot().state?.reason).toBe('hello-timeout')
    await manager.stop('plugin-dispose')
  })
})

describe('a spawn that never produced a child', () => {
  it('names the failure instead of leaving the state looking like it is still starting', () => {
    const ctx = {
      subprocess: {
        spawn: () => { throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) },
      },
    } as unknown as Context
    const manager = new CollectorManager(ctx, {
      executable: '/missing-collector',
      cwd: '/tmp',
      onMessage: () => {},
      onUnexpectedExit: () => {},
    })
    expect(() => manager.start()).toThrow(/ENOENT/)
    // The state is what an interface reads; before this it said nothing at all while `start()` had already failed.
    expect(manager.snapshot().state?.state).toBe('degraded')
    expect(manager.snapshot().state?.reason).toBe('collector-spawn-failed')
  })
})

describe('a start that is refused because one already ran', () => {
  it('says so, instead of leaving the state looking like it is still starting', () => {
    const handle: SubprocessHandle = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: undefined,
      control: undefined,
      collected: {},
      done: new Promise(() => {}),
      terminate() {},
      async waitForExit() { return true },
    }
    const ctx = { subprocess: { spawn: () => handle } } as unknown as Context
    const manager = new CollectorManager(ctx, {
      executable: '/collector',
      cwd: '/tmp',
      onMessage: () => {},
      onUnexpectedExit: () => {},
    })
    manager.start()
    // A manager that already has a handle refuses the second start. Before this the refusal was an exception the
    // caller could swallow, and the state stayed empty - which an interface reads as "still starting".
    expect(() => manager.start()).toThrow(/already started/)
    expect(manager.snapshot().state?.reason).toBe('collector-start-refused')
  })
})
