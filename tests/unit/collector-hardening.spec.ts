import { PassThrough } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it } from 'vitest'
import { PolicyRuleId } from '../../src/shared/index.js'
import { CollectorManager } from '../../src/host/collector/index.js'

function fixture(options: {
  helloTimeoutMs?: number
  ackTimeoutMs?: number
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
    ackTimeoutMs: options.ackTimeoutMs ?? 100,
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

function configured(revision: number): string {
  return JSON.stringify({
    v: 1,
    type: 'configured',
    revision,
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

    let commands = writes.join('').trim().split('\n')
      .map(line => JSON.parse(line) as { type: string })
      .map(command => command.type)
    expect(commands).toEqual(['pause', 'configure'])
    expect(settled).toBe(false)

    stdout.write(configured(2))
    await Promise.resolve()
    await Promise.resolve()
    commands = writes.join('').trim().split('\n')
      .map(line => JSON.parse(line) as { type: string })
      .map(command => command.type)
    expect(commands).toEqual(['pause', 'configure', 'resume'])

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
    stdout.write(configured(2))
    await Promise.resolve()
    await Promise.resolve()
    await applying
    await pausing
    await Promise.resolve()

    // A user pause must never be followed by a policy-driven resume.
    // The policy is applied while the helper is left paused, and the
    // queued pause is then a no-op on the already-paused native, so the
    // exact interleaving may vary but a resume must never be sent.
    const commands = writes.join('').trim().split('\n')
      .map(line => JSON.parse(line) as { type: string })
      .map(command => command.type)
    expect(commands).toContain('configure')
    expect(commands).toContain('pause')
    expect(commands).not.toContain('resume')
    expect(manager.snapshot().state?.state).toBe('paused')
    await manager.stop()
  })

  it('compiles app matcher rules into exact native bundle decisions', async () => {
    const { manager, stdout, writes } = fixture()
    stdout.write(hello())
    const initializing = manager.initialize({
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
    await Promise.resolve()

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
      'com.apple.dt.Xcode',
      'com.apple.Terminal',
      'com.apple.Preview',
      'com.apple.finder',
    ])
    expect(command.policy.protectedPathPatterns).toEqual([
      'file:///secret/*',
    ])
    stdout.write(configured(2))
    await initializing
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

    await expect(manager.initialize({
      revision: 1,
      mode: 'include-only',
      rules: [],
      updatedAtMs: 1,
    })).rejects.toThrow(/not writable/)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(manager.snapshot().state).toMatchObject({
      state: 'degraded',
      reason: 'configure-send-failed',
    })
    expect(unavailable).toBe(1)
    await manager.stop()
  })

  it('fails closed on a mismatched policy acknowledgement', async () => {
    let unavailable = 0
    const { manager, stdout } = fixture({
      onUnexpectedExit: () => { unavailable += 1 },
    })
    stdout.write(hello())

    const initializing = manager.initialize({
      revision: 3,
      mode: 'include-only',
      rules: [],
      updatedAtMs: 3,
    })
    await Promise.resolve()
    stdout.write(configured(4))

    await expect(initializing).rejects.toThrow(
      /acknowledgement mismatch/,
    )
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(manager.snapshot().state).toMatchObject({
      state: 'degraded',
      reason: 'protocol-error',
    })
    expect(unavailable).toBe(1)
    await manager.stop()
  })

  it('fails closed when policy acknowledgement times out', async () => {
    let unavailable = 0
    const { manager, stdout } = fixture({
      onUnexpectedExit: () => { unavailable += 1 },
    })
    stdout.write(hello())

    await expect(manager.initialize({
      revision: 5,
      mode: 'include-only',
      rules: [],
      updatedAtMs: 5,
    })).rejects.toThrow(/did not acknowledge policy revision 5/)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(manager.snapshot().state).toMatchObject({
      state: 'degraded',
      reason: 'configure-ack-timeout',
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

  it('preserves the native fatal reason and releases ownership', async () => {
    let unavailable = 0
    const { manager, stdout } = fixture({
      onUnexpectedExit: () => { unavailable += 1 },
    })
    stdout.write(hello())
    stdout.write(JSON.stringify({
      v: 1,
      type: 'fatal',
      code: 'native-fatal',
      message: 'collector cannot continue',
    }) + '\n')

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(manager.snapshot().state).toMatchObject({
      state: 'degraded',
      reason: 'native-fatal',
    })
    expect(unavailable).toBe(1)
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
  const stdouts: PassThrough[] = []
  const writes: string[][] = []
  let spawns = 0
  let unavailable = 0

  const ctx = {
    subprocess: {
      spawn: () => {
        spawns += 1
        const stdin = new PassThrough()
        const stdout = new PassThrough()
        const processWrites: string[] = []
        stdin.on('data', chunk => {
          processWrites.push(String(chunk))
        })
        stdouts.push(stdout)
        writes.push(processWrites)
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
  let manager!: CollectorManager
  manager = new CollectorManager(ctx, {
    executable: '/collector',
    cwd: '/tmp',
    helloTimeoutMs: 1_000,
    restartDelaysMs: [1],
    maxCrashesInWindow,
    onMessage: async message => {
      if (message.type === 'hello') {
        await manager.initialize({
          revision: 1,
          mode: 'include-only',
          rules: [],
          updatedAtMs: 1,
        })
      }
    },
    onUnexpectedExit: () => { unavailable += 1 },
  })
  manager.start()

  return {
    manager,
    exits,
    stdouts,
    writes,
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
  it('preserves an explicit pause across a recoverable restart', async () => {
    const value = restartFixture()
    value.stdouts[0]!.write(hello())
    value.stdouts[0]!.write(state('running'))
    await Promise.resolve()
    await Promise.resolve()
    value.stdouts[0]!.write(configured(1))
    await Promise.resolve()
    await Promise.resolve()

    const pausing = value.manager.pause()
    await Promise.resolve()
    value.stdouts[0]!.write(state('paused'))
    await pausing

    value.exits[0]!()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(value.spawns()).toBe(2)

    value.stdouts[1]!.write(hello())
    value.stdouts[1]!.write(state('running'))
    await Promise.resolve()
    await Promise.resolve()

    const beforeAck = value.writes[1]!.join('')
    expect(beforeAck).toContain('"type":"pause"')
    expect(beforeAck).not.toContain('"type":"configure"')

    value.stdouts[1]!.write(state('paused'))
    await Promise.resolve()
    await Promise.resolve()

    const commands = value.writes[1]!.join('').trim().split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as { type: string })
      .map(command => command.type)
    expect(commands).toEqual(['pause', 'configure'])
    value.stdouts[1]!.write(configured(1))
    await Promise.resolve()
    await Promise.resolve()
    expect(value.manager.snapshot().state?.state).toBe('paused')
    expect(value.unavailable()).toBe(0)

    await value.manager.stop()
  })

  it('opens the breaker after repeated process exits', async () => {
    const value = restartFixture(2)

    value.exits[0]!()
    await new Promise(resolve => setTimeout(resolve, 10))
    value.exits[1]!()
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(value.spawns()).toBe(2)
    expect(value.unavailable()).toBe(1)
    expect(value.manager.snapshot().state?.state).toBe('degraded')
    await value.manager.stop()
  })
})

describe('collector ownership handover', () => {
  it('does not resolve stop() before the capture lock has been released', async () => {
    let releaseOwnership!: () => void
    const ownershipReleased = new Promise<void>(resolve => {
      releaseOwnership = resolve
    })
    let exit!: () => void
    const done = new Promise<{
      exitCode: number | null
      signal: NodeJS.Signals | null
    }>(resolve => {
      exit = () => resolve({ exitCode: 0, signal: null })
    })

    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const ctx = {
      subprocess: {
        spawn: () => ({
          stdin,
          stdout,
          stderr: undefined,
          control: undefined,
          collected: {},
          done,
          terminate() {},
          async waitForExit() { return true },
        } as SubprocessHandle),
      },
    } as unknown as Context

    const manager = new CollectorManager(ctx, {
      executable: '/collector',
      cwd: '/tmp',
      graceMs: 100,
      onMessage: () => {},
      // Deliberately slow handover: a successor Host probing the
      // same lock file with zero wait must not observe contention
      // from an owner that has already committed to releasing.
      onUnexpectedExit: () => ownershipReleased,
    })
    manager.start()
    stdout.write(hello())

    exit()
    let stopped = false
    const stopping = manager.stop('protocol-error').then(() => {
      stopped = true
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(stopped).toBe(false)

    releaseOwnership()
    await stopping
    expect(stopped).toBe(true)
  })
})

describe('policy propagation without a running helper', () => {
  it('configures in place instead of wedging a permission-required helper', async () => {
    const { manager, stdout, writes } = fixture()
    stdout.write(hello())
    stdout.write(JSON.stringify({
      v: 1,
      type: 'state',
      state: 'permission-required',
      accessibilityTrusted: false,
      reason: 'accessibility',
    }) + '\n')
    await Promise.resolve()

    const applying = manager.applyPolicy({
      revision: 9,
      mode: 'include-only',
      rules: [],
      updatedAtMs: 9,
    })
    await Promise.resolve()
    await Promise.resolve()

    // A helper that is not running must not be paused: it emits no
    // state transitions while paused, so a pause would deadlock the
    // Host and a resume could never be acknowledged.
    const sent = writes.join('').trim().split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as { type: string })
      .map(command => command.type)
    expect(sent).toEqual(['configure'])

    stdout.write(configured(9))
    await applying
    expect(manager.snapshot().state?.state)
      .toBe('permission-required')
    await manager.stop()
  })
})

describe('control acknowledgement budget', () => {
  it('accepts permission-required as a satisfied resume', async () => {
    const { manager, stdout, writes } = fixture({ ackTimeoutMs: 30 })
    stdout.write(hello())
    stdout.write(state('paused'))
    await Promise.resolve()

    // Native acknowledges resume by reporting the accessibility gate,
    // not `running`. Treating that as a timeout would kill a healthy
    // helper and release capture ownership for the rest of the session.
    const resuming = manager.resume()
    await Promise.resolve()
    expect(writes.join('')).toContain('"type":"resume"')

    stdout.write(JSON.stringify({
      v: 1,
      type: 'state',
      state: 'permission-required',
      accessibilityTrusted: false,
      reason: 'accessibility',
    }) + '\n')

    await resuming
    expect(manager.snapshot().state?.state)
      .toBe('permission-required')
    // Capture ownership must survive: no degradation, no stop.
    expect(manager.snapshot().state?.reason).toBe('accessibility')
    await manager.stop()
  })

  it('waits past the subprocess grace period for a configure ack', async () => {
    const { manager, stdout } = fixture({ ackTimeoutMs: 120 })
    stdout.write(hello())

    const initializing = manager.initialize({
      revision: 11,
      mode: 'include-only',
      rules: [],
      updatedAtMs: 11,
    })

    // The helper performs synchronous AX work before acknowledging, so
    // a configure ack may legitimately arrive after `graceMs`.
    await new Promise(resolve => setTimeout(resolve, 60))
    stdout.write(configured(11))

    await expect(initializing).resolves.toBeUndefined()
    expect(manager.snapshot().state?.state).not.toBe('degraded')
    await manager.stop()
  })
})

describe('unconditional ownership handover', () => {
  it('hands ownership back even when the exit wait never settles', async () => {
    let released = 0
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const ctx = {
      subprocess: {
        spawn: () => ({
          stdin,
          stdout,
          stderr: undefined,
          control: undefined,
          collected: {},
          done: new Promise(() => {}),
          terminate() {},
          // Never settles, as a wedged provider may.
          waitForExit: () => new Promise<boolean>(() => {}),
        } as SubprocessHandle),
      },
    } as unknown as Context

    const manager = new CollectorManager(ctx, {
      executable: '/collector',
      cwd: '/tmp',
      graceMs: 20,
      ackTimeoutMs: 20,
      onMessage: () => {},
      onUnexpectedExit: () => {
        released += 1
      },
    })
    manager.start()
    stdout.write(hello())

    await manager.stop('plugin-dispose')
    expect(released).toBe(1)
    // Idempotent: a later stop must not release ownership twice.
    await manager.stop('plugin-dispose')
    expect(released).toBe(1)
  })

  it('hands ownership back when there is no live helper', async () => {
    let released = 0
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const ctx = {
      subprocess: {
        spawn: () => ({
          stdin,
          stdout,
          stderr: undefined,
          control: undefined,
          collected: {},
          done: Promise.resolve({ exitCode: 0, signal: null }),
          terminate() {},
          async waitForExit() { return true },
        } as SubprocessHandle),
      },
    } as unknown as Context

    const manager = new CollectorManager(ctx, {
      executable: '/collector',
      cwd: '/tmp',
      graceMs: 20,
      ackTimeoutMs: 20,
      onMessage: () => {},
      onUnexpectedExit: () => {
        released += 1
      },
    })
    manager.start()
    stdout.write(hello())

    await manager.stop('plugin-dispose')
    expect(released).toBe(1)
  })
})

describe('unconfirmed helper exit', () => {
  it('releases ownership but records an unconfirmed exit', async () => {
    let released = 0
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const ctx = {
      subprocess: {
        spawn: () => ({
          stdin,
          stdout,
          stderr: undefined,
          control: undefined,
          collected: {},
          done: new Promise(() => {}),
          terminate() {},
          // Never confirms the managed range is empty.
          waitForExit: () => new Promise<boolean>(() => {}),
        } as SubprocessHandle),
      },
    } as unknown as Context

    const manager = new CollectorManager(ctx, {
      executable: '/collector',
      cwd: '/tmp',
      graceMs: 20,
      ackTimeoutMs: 20,
      onMessage: () => {},
      onUnexpectedExit: () => {
        released += 1
      },
    })
    manager.start()
    stdout.write(hello())

    await manager.stop('plugin-dispose')

    // Ownership still moves on: holding the lock forever would leave
    // ambient capture permanently unavailable. The unconfirmed exit is
    // recorded instead of being silently ignored.
    expect(released).toBe(1)
    expect(manager.snapshot().state).toMatchObject({
      state: 'degraded',
      reason: 'collector-exit-unconfirmed',
    })
  })
})
