import { PassThrough } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it } from 'vitest'
import { PolicyRuleId } from '../../src/shared/index.js'
import { CollectorManager } from '../../src/host/collector/index.js'

function fixture(options: {
  helloTimeoutMs?: number
  onUnexpectedExit?: () => void
} = {}) {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const writes: string[] = []
  stdin.on('data', chunk => { writes.push(String(chunk)) })

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
  const manager = new CollectorManager(ctx, {
    executable: '/collector',
    cwd: '/tmp',
    graceMs: 100,
    ...(options.helloTimeoutMs === undefined
      ? {}
      : { helloTimeoutMs: options.helloTimeoutMs }),
    onMessage: () => {},
    ...(options.onUnexpectedExit
      ? { onUnexpectedExit: options.onUnexpectedExit }
      : {}),
  })
  manager.start()
  return { manager, stdin, stdout, writes }
}

function hello(): string {
  return JSON.stringify({
    v: 1,
    type: 'hello',
    collectorSession: 's1',
    collectorVersion: '0.1.0',
    platform: 'darwin',
    arch: 'arm64',
    capabilities: [],
  }) + '\n'
}

function state(value: 'running' | 'paused'): string {
  return JSON.stringify({
    v: 1,
    type: 'state',
    state: value,
    accessibilityTrusted: true,
  }) + '\n'
}

function observation(seq: number, pid = 1): string {
  return JSON.stringify({
    v: 1,
    type: 'observation',
    collectorSession: 's1',
    seq,
    observedAtMs: 1_000 + seq,
    app: {
      pid,
      bundleId: 'com.microsoft.VSCode',
    },
    privacy: {
      secure: false,
      protected: false,
    },
    source: { adapter: 'vscode' },
  }) + '\n'
}

describe('collector protocol lifecycle hardening', () => {
  it('waits for the native pause acknowledgement', async () => {
    const { manager, stdout, writes } = fixture()
    stdout.write(hello())
    stdout.write(state('running'))
    let settled = false
    const pause = manager.pause().then(() => {
      settled = true
    })
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(writes.join('')).toContain('"type":"pause"')

    stdout.write(state('paused'))
    await pause
    expect(manager.snapshot().state?.state).toBe('paused')
    await manager.stop()
  })

  it('applies a running policy change behind pause and resume acknowledgements', async () => {
    const { manager, stdout, writes } = fixture()
    stdout.write(hello())
    stdout.write(state('running'))

    let settled = false
    const applying = manager.applyPolicy({
      revision: 2,
      mode: 'include-only',
      updatedAtMs: 2,
      rules: [],
    }).then(() => { settled = true })
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(writes.join('')).toContain('"type":"pause"')
    expect(writes.join('')).not.toContain('"type":"configure"')

    stdout.write(state('paused'))
    await Promise.resolve()
    await Promise.resolve()

    const commands = writes.join('').trim().split('\n')
      .map(line => JSON.parse(line) as { type: string })
      .map(command => command.type)
    expect(commands).toEqual(['pause', 'configure', 'resume'])
    expect(settled).toBe(false)

    stdout.write(state('running'))
    await applying
    expect(settled).toBe(true)
    await manager.stop()
  })

  it('serializes a user pause behind policy propagation so pause wins', async () => {
    const { manager, stdout, writes } = fixture()
    stdout.write(hello())
    stdout.write(state('running'))

    const applying = manager.applyPolicy({
      revision: 2,
      mode: 'include-only',
      updatedAtMs: 2,
      rules: [],
    })
    const pausing = manager.pause()
    await Promise.resolve()

    stdout.write(state('paused'))
    await Promise.resolve()
    await Promise.resolve()
    stdout.write(state('running'))
    await applying
    await Promise.resolve()

    const beforeFinalAck = writes.join('').trim().split('\n')
      .map(line => JSON.parse(line) as { type: string })
      .map(command => command.type)
    expect(beforeFinalAck).toEqual([
      'pause',
      'configure',
      'resume',
      'pause',
    ])

    stdout.write(state('paused'))
    await pausing
    expect(manager.snapshot().state?.state).toBe('paused')
    await manager.stop()
  })

  it('compiles app matcher rules into exact native bundle decisions', async () => {
    const { manager, stdout, writes } = fixture()
    stdout.write(hello())
    manager.configure({
      revision: 2,
      mode: 'exclude',
      updatedAtMs: 2,
      rules: [
        {
          id: PolicyRuleId('allow-code'),
          dimension: 'app',
          action: 'allow',
          matcher: 'exact',
          pattern: 'com.microsoft.VSCode',
          builtIn: false,
          createdAtMs: 1,
          updatedAtMs: 1,
        },
        {
          id: PolicyRuleId('deny-cursor-family'),
          dimension: 'app',
          action: 'deny',
          matcher: 'prefix',
          pattern: 'com.todesktop.',
          builtIn: false,
          createdAtMs: 1,
          updatedAtMs: 1,
        },
        {
          id: PolicyRuleId('protect-apple'),
          dimension: 'app',
          action: 'protect',
          matcher: 'glob',
          pattern: 'com.apple.*',
          builtIn: false,
          createdAtMs: 1,
          updatedAtMs: 1,
        },
        {
          id: PolicyRuleId('protect-secret-prefix'),
          dimension: 'resource',
          action: 'protect',
          matcher: 'prefix',
          pattern: 'file:///secret/',
          builtIn: false,
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ],
    })

    const command = JSON.parse(writes.at(-1)!) as {
      policy: {
        mode: string
        allowedBundleIds: string[]
        blockedBundleIds: string[]
        protectedBundleIds: string[]
        protectedPathPatterns: string[]
      }
    }
    expect(command.policy.mode).toBe('include-only')
    expect(command.policy.allowedBundleIds).toEqual([
      'com.microsoft.VSCode',
    ])
    expect(command.policy.blockedBundleIds).toEqual([
      'com.todesktop.230313mzl4w4u92',
    ])
    expect(command.policy.protectedBundleIds).toEqual([
      'com.apple.Terminal',
      'com.apple.Preview',
      'com.apple.finder',
    ])
    expect(command.policy.protectedPathPatterns).toEqual([
      'file:///secret/*',
    ])
    await manager.stop()
  })

  it('fails closed when policy propagation cannot reach the helper', async () => {
    let unavailable = 0
    const { manager, stdin, stdout } = fixture({
      onUnexpectedExit: () => { unavailable += 1 },
    })
    stdout.write(hello())
    stdout.write(state('running'))
    stdin.destroy()

    expect(() => manager.configure({
      revision: 1,
      mode: 'include-only',
      rules: [],
      updatedAtMs: 1,
    })).toThrow(/not writable/)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(manager.snapshot().state).toMatchObject({
      state: 'degraded',
      reason: 'configure-send-failed',
    })
    expect(unavailable).toBe(1)
    await manager.stop()
  })

  it('fails closed when pause acknowledgement times out', async () => {
    let unavailable = 0
    const { manager, stdout } = fixture({
      onUnexpectedExit: () => { unavailable += 1 },
    })
    stdout.write(hello())
    stdout.write(state('running'))

    await expect(manager.pause()).rejects.toThrow(
      /did not acknowledge paused/,
    )
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(manager.snapshot().state).toMatchObject({
      state: 'degraded',
      reason: 'paused-ack-timeout',
    })
    expect(unavailable).toBe(1)
    await manager.stop()
  })

  it('releases ownership when the helper never handshakes', async () => {
    let unavailable = 0
    const { manager } = fixture({
      helloTimeoutMs: 5,
      onUnexpectedExit: () => { unavailable += 1 },
    })

    await new Promise(resolve => setTimeout(resolve, 15))

    expect(manager.snapshot().state).toMatchObject({
      state: 'degraded',
      reason: 'hello-timeout',
    })
    expect(unavailable).toBe(1)
    await manager.stop()
  })

  it('rejects protocol traffic before hello', async () => {
    const { manager, stdout } = fixture()
    stdout.write(state('running'))
    expect(manager.snapshot().state).toMatchObject({
      state: 'degraded',
      reason: 'protocol-error',
    })
    await manager.stop()
  })

  it('rejects collector sequence regression', async () => {
    const { manager, stdout } = fixture()
    stdout.write(hello())
    stdout.write(observation(2))
    stdout.write(observation(1))
    expect(manager.snapshot().state?.state).toBe('degraded')
    await manager.stop()
  })

  it('ignores exact duplicate sequences but rejects conflicting duplicates', async () => {
    const { manager, stdout } = fixture()
    stdout.write(hello())
    stdout.write(observation(1))
    stdout.write(observation(1))
    expect(manager.snapshot().state?.state).not.toBe('degraded')

    stdout.write(observation(1, 2))
    expect(manager.snapshot().state).toMatchObject({
      state: 'degraded',
      reason: 'protocol-error',
    })
    await manager.stop()
  })

  it('terminates a spawned helper when required stdio is unavailable', () => {
    let terminated = false
    const handle = {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      control: undefined,
      collected: {},
      done: Promise.resolve({ exitCode: 1, signal: null }),
      terminate() { terminated = true },
      async waitForExit() { return true },
    } as SubprocessHandle
    const ctx = {
      subprocess: { spawn: () => handle },
    } as unknown as Context
    const manager = new CollectorManager(ctx, {
      executable: '/collector',
      cwd: '/tmp',
      onMessage: () => {},
    })

    expect(() => manager.start()).toThrow(/piped stdio/)
    expect(terminated).toBe(true)
  })
})

function restartFixture(maxCrashesInWindow = 5) {
  const exits: Array<() => void> = []
  let spawns = 0
  let unavailable = 0

  const ctx = {
    subprocess: {
      spawn: () => {
        spawns += 1
        const stdin = new PassThrough()
        const stdout = new PassThrough()
        let exit!: () => void
        const done = new Promise<{
          exitCode: number | null
          signal: NodeJS.Signals | null
        }>(resolve => {
          exit = () => resolve({
            exitCode: 1,
            signal: null,
          })
        })
        exits.push(exit)
        return {
          stdin,
          stdout,
          stderr: undefined,
          control: undefined,
          collected: {},
          done,
          terminate() {},
          async waitForExit() { return true },
        } as SubprocessHandle
      },
    },
  } as unknown as Context
  const manager = new CollectorManager(ctx, {
    executable: '/collector',
    cwd: '/tmp',
    helloTimeoutMs: 1_000,
    restartDelaysMs: [1],
    maxCrashesInWindow,
    onMessage: () => {},
    onUnexpectedExit: () => { unavailable += 1 },
  })
  manager.start()

  return {
    manager,
    exits,
    spawns: () => spawns,
    unavailable: () => unavailable,
  }
}

describe('collector restart breaker', () => {
  it('restarts a recoverable process exit without releasing ownership', async () => {
    const value = restartFixture()
    value.exits[0]!()

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(value.spawns()).toBe(2)
    expect(value.unavailable()).toBe(0)
    await value.manager.stop()
  })
  it('opens the breaker after repeated process exits', async () => {
    const value = restartFixture(2)

    value.exits[0]!()
    await new Promise(resolve => setTimeout(resolve, 10))
    value.exits[1]!()
    await new Promise(resolve => setTimeout(resolve, 10))
    value.exits[2]!()
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(value.spawns()).toBe(3)
    expect(value.unavailable()).toBe(1)
    expect(value.manager.snapshot().state?.state).toBe('degraded')
    await value.manager.stop()
  })
})
