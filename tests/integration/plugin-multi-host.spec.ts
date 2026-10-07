import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../../src/host/plugin.js'
import {
  openHistoryDatabase,
  PolicyStore,
} from '../../src/host/store/index.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function fakeHost(spawned: { count: number }) {
  const disposers: Array<() => void | Promise<void>> = []
  const stdouts: PassThrough[] = []
  const writes: string[][] = []
  const services = new Map<string, unknown>()
  const ctx = {
    subprocess: {
      spawn: () => {
        spawned.count += 1
        const stdin = new PassThrough()
        const stdout = new PassThrough()
        const childWrites: string[] = []
        stdin.on('data', chunk => { childWrites.push(String(chunk)) })
        stdouts.push(stdout)
        writes.push(childWrites)
        return {
          stdin,
          stdout,
          stderr: undefined,
          control: undefined,
          collected: {},
          done: new Promise(() => {}),
          terminate() {},
          async waitForExit() { return true },
        } as SubprocessHandle
      },
    },
    workspaceRegistry: {
      list: () => [],
      resolveByPath: async () => undefined,
    },
    connection: {
      fetch: {
        register: () => () => {},
      },
    },
    agents: {
      list: () => [],
    },
    tools: {},
    systemPrompt: {},
    on: () => () => {},
    effect(factory: () => unknown) {
      const dispose = factory()
      if (typeof dispose === 'function') {
        disposers.push(
          dispose as () => void | Promise<void>,
        )
      }
    },
    async plugin(
      _plugin: unknown,
      options: { backend: unknown },
    ) {
      services.set('computerHistory', options.backend)
      return { dispose: async () => {} }
    },
    // cordis inject-free accessor — the only sanctioned way for the plugin to
    // read the service it provides itself.
    get(name: string) {
      return services.get(name)
    },
  } as unknown as Context

  return {
    ctx,
    stdouts,
    writes,
    async dispose() {
      for (const dispose of disposers.toReversed()) {
        // oxlint-disable-next-line no-await-in-loop -- lifecycle teardown must remain reverse-ordered
        await dispose()
      }
    },
  }
}
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 750,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    // oxlint-disable-next-line no-await-in-loop -- deliberately polling an in-process protocol transcript
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('timed out waiting for collector protocol output')
}

describe('plugin multi-Host capture composition', () => {
  it('spawns only one collector and allows takeover after owner disposal', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-plugin-host-'),
    )
    roots.push(root)
    const dataDirectory = path.join(root, 'history')
    const spawned = { count: 0 }

    const first = fakeHost(spawned)
    await apply(first.ctx, {
      enabled: true,
      dataDirectory,
      collectorExecutable: '/collector',
      collectorRestart: false,
      captureLockProbeWaitMs: 250,
    })
    expect(spawned.count).toBe(1)

    const second = fakeHost(spawned)
    await apply(second.ctx, {
      enabled: true,
      dataDirectory,
      collectorExecutable: '/collector',
      collectorRestart: false,
      captureLockProbeWaitMs: 250,
    })
    expect(spawned.count).toBe(1)

    const secondHistory = (
      second.ctx as unknown as {
        get(name: 'computerHistory'): {
          recent(): Promise<readonly unknown[]>
          delete(request: unknown): Promise<unknown>
          replacePolicy(update: unknown): Promise<unknown>
          getState(): { reason?: string }
        }
      }
    ).get('computerHistory')

    expect(secondHistory.getState().reason)
      .toBe('capture-owned-by-another-host')
    expect(await secondHistory.recent()).toEqual([])
    await expect(secondHistory.replacePolicy({
      mode: 'include-only',
      rules: [],
    })).rejects.toThrow(/owned by another DSH Host/)
    await expect(secondHistory.delete({
      scope: { kind: 'all' },
    })).resolves.toMatchObject({
      observationsDeleted: 0,
      episodesDeleted: 0,
      episodesRebuilt: 0,
    })

    await first.dispose()

    const successor = fakeHost(spawned)
    await apply(successor.ctx, {
      enabled: true,
      dataDirectory,
      collectorExecutable: '/collector',
      collectorRestart: false,
      captureLockProbeWaitMs: 250,
    })
    expect(spawned.count).toBe(2)

    await successor.dispose()
    await second.dispose()
  })

  it('lets an already-running read-only Host recover after the owner exits', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-plugin-recover-host-'),
    )
    roots.push(root)
    const dataDirectory = path.join(root, 'history')
    const spawned = { count: 0 }

    const first = fakeHost(spawned)
    await apply(first.ctx, {
      enabled: true,
      dataDirectory,
      collectorExecutable: '/collector',
      collectorRestart: false,
      captureLockProbeWaitMs: 25,
    })
    expect(spawned.count).toBe(1)

    const second = fakeHost(spawned)
    await apply(second.ctx, {
      enabled: true,
      dataDirectory,
      collectorExecutable: '/collector',
      collectorRestart: false,
      captureLockProbeWaitMs: 25,
    })
    expect(spawned.count).toBe(1)

    const secondHistory = (
      second.ctx as unknown as {
        get(name: 'computerHistory'): {
          recover(): Promise<void>
          replacePolicy(update: unknown): Promise<{ revision: number }>
          getState(): { capture: string; reason?: string }
        }
      }
    ).get('computerHistory')

    expect(secondHistory.getState()).toMatchObject({
      capture: 'degraded',
      reason: 'capture-owned-by-another-host',
    })
    await expect(secondHistory.recover()).rejects.toThrow(
      /owned by another DSH Host/,
    )
    expect(spawned.count).toBe(1)

    await first.dispose()

    const recovering = secondHistory.recover()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(spawned.count).toBe(2)
    second.stdouts[0]!.write(JSON.stringify({
      v: 1,
      type: 'hello',
      collectorSession: 'recovered-session',
      collectorVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      capabilities: [],
    }) + '\n')
    await Promise.resolve()
    await Promise.resolve()
    second.stdouts[0]!.write(JSON.stringify({
      v: 1,
      type: 'state',
      state: 'running',
      accessibilityTrusted: true,
    }) + '\n')
    let recovered = false
    void recovering.then(() => { recovered = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(recovered).toBe(false)
    second.stdouts[0]!.write(JSON.stringify({
      v: 1,
      type: 'configured',
      revision: 1,
    }) + '\n')
    await recovering
    expect(recovered).toBe(true)

    expect(secondHistory.getState()).toMatchObject({
      capture: 'running',
    })
    // This Host owns capture and its collector is running, but its data directory is fresh, so its policy is the
    // initial include-only one - which allows nothing. Asking for no reason here asserted the defect: a Host that
    // reports `running` while it can record nothing has to say so. Measured 2026-10-06 on the owner's machine and
    // reproduced in an isolated Host (`capture=running`, `refusedByReason={}`, `store 0|0`).
    expect(secondHistory.getState().reason).toBe('no-apps-allowed')

    // This Host did not have a CollectorManager when its backend was built.
    // Recovery created one later; policy propagation must follow that current
    // manager rather than the manager value captured at construction time.
    second.writes[0]!.length = 0
    const replacing = secondHistory.replacePolicy({
      mode: 'include-only',
      rules: [],
    })

    await waitFor(() =>
      second.writes[0]!.join('').includes('"type":"pause"'),
    )
    second.stdouts[0]!.write(JSON.stringify({
      v: 1,
      type: 'state',
      state: 'paused',
      accessibilityTrusted: true,
    }) + '\n')

    await waitFor(() =>
      second.writes[0]!.join('').includes(
        '"type":"configure","revision":2',
      ),
    )
    second.stdouts[0]!.write(JSON.stringify({
      v: 1,
      type: 'configured',
      revision: 2,
    }) + '\n')

    await waitFor(() =>
      second.writes[0]!.join('').includes('"type":"resume"'),
    )
    second.stdouts[0]!.write(JSON.stringify({
      v: 1,
      type: 'state',
      state: 'running',
      accessibilityTrusted: true,
    }) + '\n')

    await expect(replacing).resolves.toMatchObject({ revision: 2 })
    expect(second.writes[0]!.join('')).toContain(
      '"type":"configure","revision":2',
    )

    await second.dispose()
  })

  it('releases fatal ownership and rejects stale owner controls', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-plugin-fatal-'),
    )
    roots.push(root)
    const dataDirectory = path.join(root, 'history')
    const spawned = { count: 0 }

    const first = fakeHost(spawned)
    await apply(first.ctx, {
      enabled: true,
      dataDirectory,
      collectorExecutable: '/collector',
      collectorRestart: false,
      captureLockProbeWaitMs: 250,
    })
    const firstHistory = (
      first.ctx as unknown as {
        get(name: 'computerHistory'): { pause(): Promise<void> }
      }
    ).get('computerHistory')

    first.stdouts[0]!.write(JSON.stringify({
      v: 1,
      type: 'hello',
      collectorSession: 'fatal-session',
      collectorVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      capabilities: [],
    }) + '\n')
    await Promise.resolve()
    await Promise.resolve()
    first.stdouts[0]!.write(JSON.stringify({
      v: 1,
      type: 'configured',
      revision: 1,
    }) + '\n')
    await Promise.resolve()
    await Promise.resolve()

    first.stdouts[0]!.write(JSON.stringify({
      v: 1,
      type: 'fatal',
      code: 'native-fatal',
      message: 'cannot continue',
    }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 0))

    await expect(firstHistory.pause()).rejects.toThrow(
      /unavailable on this DSH Host/,
    )

    const successor = fakeHost(spawned)
    await apply(successor.ctx, {
      enabled: true,
      dataDirectory,
      collectorExecutable: '/collector',
      collectorRestart: false,
      captureLockProbeWaitMs: 250,
    })
    expect(spawned.count).toBe(2)

    await successor.dispose()
    await first.dispose()
  })

  it('tightens a legacy exclude policy before any collector can start', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-legacy-policy-'),
    )
    roots.push(root)
    const dataDirectory = path.join(root, 'history')
    const seeded = openHistoryDatabase({ dataDirectory, nowMs: 1 })
    const policies = new PolicyStore(seeded.db)
    policies.ensureInitial(1)
    policies.replace('exclude', [], 2)
    seeded.close()

    const host = fakeHost({ count: 0 })
    await apply(host.ctx, {
      enabled: false,
      dataDirectory,
    })

    const current = (
      host.ctx as unknown as {
        get(name: 'computerHistory'): {
          getPolicy(): { mode: string }
        }
      }
    ).get('computerHistory').getPolicy()
    expect(current.mode).toBe('include-only')
    await host.dispose()
  })
})
