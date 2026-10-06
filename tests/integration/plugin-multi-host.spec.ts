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
  const services = new Map<string, unknown>()
  const ctx = {
    subprocess: {
      spawn: () => {
        spawned.count += 1
        const stdin = new PassThrough()
        const stdout = new PassThrough()
        stdouts.push(stdout)
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
    async dispose() {
      for (const dispose of disposers.toReversed()) {
        // oxlint-disable-next-line no-await-in-loop -- lifecycle teardown must remain reverse-ordered
        await dispose()
      }
    },
  }
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
      companionPort: 0,
    })
    expect(spawned.count).toBe(1)

    const firstHistory = (
      first.ctx as unknown as {
        get(name: 'computerHistory'): {
          getState(): {
            companion?: { listening: boolean; port?: number }
          }
        }
      }
    ).get('computerHistory')
    let ownerPort: number | undefined
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const companion = firstHistory.getState().companion
      if (companion?.listening && companion.port !== undefined) {
        ownerPort = companion.port
        break
      }
      // oxlint-disable-next-line no-await-in-loop -- waiting for the real loopback bind is the assertion setup
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    if (ownerPort === undefined) {
      throw new Error('owner companion did not bind')
    }

    const second = fakeHost(spawned)
    await apply(second.ctx, {
      enabled: true,
      dataDirectory,
      collectorExecutable: '/collector',
      collectorRestart: false,
      captureLockProbeWaitMs: 25,
      companionPort: ownerPort,
    })
    expect(spawned.count).toBe(1)

    const secondHistory = (
      second.ctx as unknown as {
        get(name: 'computerHistory'): {
          recover(): Promise<void>
          getState(): {
            capture: string
            reason?: string
            companion?: { listening: boolean; port?: number }
          }
        }
      }
    ).get('computerHistory')

    expect(secondHistory.getState()).toMatchObject({
      capture: 'degraded',
      reason: 'capture-owned-by-another-host',
      companion: {
        listening: false,
      },
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
      companion: {
        listening: true,
        port: ownerPort,
      },
    })
    // This Host owns capture and its collector is running, but its data directory is fresh, so its policy is the
    // initial include-only one - which allows nothing. Asking for no reason here asserted the defect: a Host that
    // reports `running` while it can record nothing has to say so. Measured 2026-10-06 on the owner's machine and
    // reproduced in an isolated Host (`capture=running`, `refusedByReason={}`, `store 0|0`).
    expect(secondHistory.getState().reason).toBe('no-apps-allowed')

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
