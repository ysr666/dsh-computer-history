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
  const ctx = {
    subprocess: {
      spawn: () => {
        spawned.count += 1
        const stdin = new PassThrough()
        const stdout = new PassThrough()
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
      ;(ctx as unknown as {
        computerHistory: unknown
      }).computerHistory = options.backend
      return { dispose: async () => {} }
    },
  } as unknown as Context

  return {
    ctx,
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
    })
    expect(spawned.count).toBe(1)

    const second = fakeHost(spawned)
    await apply(second.ctx, {
      enabled: true,
      dataDirectory,
      collectorExecutable: '/collector',
      collectorRestart: false,
    })
    expect(spawned.count).toBe(1)

    const secondHistory = (
      second.ctx as unknown as {
        computerHistory: {
          recent(): Promise<readonly unknown[]>
          delete(request: unknown): Promise<unknown>
          replacePolicy(update: unknown): Promise<unknown>
          getState(): { reason?: string }
        }
      }
    ).computerHistory

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
    })
    expect(spawned.count).toBe(2)

    await successor.dispose()
    await second.dispose()
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
        computerHistory: {
          getPolicy(): { mode: string }
        }
      }
    ).computerHistory.getPolicy()
    expect(current.mode).toBe('include-only')
    await host.dispose()
  })
})
