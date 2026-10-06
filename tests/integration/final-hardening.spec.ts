import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OBSERVATION_RETENTION_MS,
  PolicyRuleId,
  type NativeObservation,
} from '../../src/shared/index.js'
import { IngestionService } from '../../src/host/ingestion/index.js'
import {
  LocalComputerHistoryBackend,
  type CaptureController,
} from '../../src/host/service/index.js'
import { DeletionService, RetentionService } from '../../src/host/retention/index.js'
import {
  EpisodeStore,
  ObservationStore,
  openHistoryDatabase,
  PolicyStore,
} from '../../src/host/store/index.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
function openPair() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-hardening-'))
  roots.push(root)
  const dataDirectory = path.join(root, 'history')
  return {
    primary: openHistoryDatabase({ dataDirectory, nowMs: 1 }),
    secondary: openHistoryDatabase({ dataDirectory, nowMs: 1 }),
  }
}

function allowCode(store: PolicyStore, nowMs: number): void {
  store.ensureInitial(nowMs)
  store.replace('include-only', [{
    id: PolicyRuleId('allow-code'),
    dimension: 'app',
    action: 'allow',
    matcher: 'exact',
    pattern: 'com.microsoft.VSCode',
    builtIn: false,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }], nowMs)
}

function native(atMs = 1_000): NativeObservation {
  return {    v: 1,
    type: 'observation',
    collectorSession: 'hardening-session',
    seq: 1,
    observedAtMs: atMs,
    app: {
      pid: 10,
      bundleId: 'com.microsoft.VSCode',
      name: 'Code',
    },
    window: {
      title: 'provider.ts',
      document: '/alpha/src/provider.ts',
    },
    privacy: {
      secure: false,
      protected: false,
    },
    source: { adapter: 'vscode' },
  }
}

describe('final ingestion hardening', () => {
  it('rechecks policy after asynchronous workspace resolution', async () => {
    const { primary, secondary } = openPair()
    const primaryPolicy = new PolicyStore(primary.db)
    allowCode(primaryPolicy, 10)
    const secondaryPolicy = new PolicyStore(secondary.db)
    let changed = false
    const ingestion = new IngestionService(
      primary.db,
      {
        resolve: async () => {
          if (!changed) {
            changed = true
            secondaryPolicy.replace('include-only', [], 20)
          }
          return {
            id: 'alpha',
            root: '/alpha',
            title: 'alpha',
            source: 'dsh' as const,
            confidence: 1,
          }
        },
      },
      () => primaryPolicy.get(),
      () => 30,
    )

    expect(await ingestion.ingest(native())).toBe(false)
    expect(new ObservationStore(primary.db).count()).toBe(0)
    expect(new EpisodeStore(primary.db).listRecent()).toEqual([])

    secondary.close()
    primary.close()
  })

  it('cannot resurrect an observation after its raw TTL', async () => {
    const { primary, secondary } = openPair()
    const policy = new PolicyStore(primary.db)
    allowCode(policy, 10)

    new DeletionService(secondary.db).delete({
      scope: { kind: 'all' },
    }, 2_000)
    new RetentionService(secondary.db).sweep(
      OBSERVATION_RETENTION_MS + 3_000,
    )

    const ingestion = new IngestionService(
      primary.db,
      {
        resolve: async () => ({
          id: 'alpha',
          root: '/alpha',
          title: 'alpha',
          source: 'dsh',
          confidence: 1,
        }),
      },
      () => policy.get(),
      () => OBSERVATION_RETENTION_MS + 4_000,
    )

    expect(await ingestion.ingest(native(1_000))).toBe(false)
    expect(new ObservationStore(primary.db).count()).toBe(0)
    secondary.close()
    primary.close()
  })

  it('does not replay a partial raw tail after retention compaction', async () => {
    const { primary, secondary } = openPair()
    const policy = new PolicyStore(primary.db)
    allowCode(policy, 10)
    let now = 1_000_000
    const resolver = {
      resolve: async () => ({
        id: 'alpha',
        root: '/alpha',
        title: 'alpha',
        source: 'dsh' as const,
        confidence: 1,
      }),
    }
    const ingestion = new IngestionService(
      primary.db,
      resolver,
      () => policy.get(),
      () => now,
    )

    expect(await ingestion.ingest(native(now))).toBe(true)
    now += 60_000
    expect(await ingestion.ingest({
      ...native(now),
      seq: 2,
      window: {
        title: 'second.ts',
        document: '/alpha/src/second.ts',
      },
    })).toBe(true)

    const original = new EpisodeStore(primary.db)
      .listRecent()[0]
    expect(original).toBeDefined()

    now = 1_000_000 + OBSERVATION_RETENTION_MS + 30_000
    expect(
      new RetentionService(primary.db).sweep(now),
    ).toEqual({
      observationsDeleted: 1,
      episodesDeleted: 0,
    })
    ingestion.reseed()

    now += 10_000
    expect(await ingestion.ingest({
      ...native(now),
      seq: 3,
      window: {
        title: 'third.ts',
        document: '/alpha/src/third.ts',
      },
    })).toBe(true)

    const episodes = new EpisodeStore(primary.db).listRecent()
    expect(episodes).toHaveLength(2)
    expect(episodes.some(episode =>
      episode.id === original!.id
      && episode.resources.some(resource =>
        resource.canonicalUri.endsWith('/second.ts'),
      )
    )).toBe(true)
    expect(episodes.some(episode =>
      episode.id !== original!.id
      && episode.startedAtMs === now
      && episode.resources.length === 1
      && episode.resources[0]?.canonicalUri.endsWith('/third.ts')
    )).toBe(true)

    secondary.close()
    primary.close()
  })
})

class NoopCapture implements CaptureController {
  public pause(): Promise<void> { return Promise.resolve() }
  public resume(): Promise<void> { return Promise.resolve() }
  public recover(): Promise<void> { return Promise.resolve() }
  public getState() {
    return {
      enabled: true,
      capture: 'running' as const,
      accessibilityTrusted: true,
    }
  }
}

describe('post-forget re-derivation safety', () => {
  it('never re-derives an episode from evidence a forget already removed', async () => {
    const { primary, secondary } = openPair()
    const policy = new PolicyStore(primary.db)
    allowCode(policy, 10)
    let now = 1_000_000
    const ingestion = new IngestionService(
      primary.db,
      {
        resolve: async () => ({
          id: 'alpha',
          root: '/alpha',
          title: 'alpha',
          source: 'dsh' as const,
          confidence: 1,
        }),
      },
      () => policy.get(),
      () => now,
    )

    await ingestion.ingest(native(now - 1_000))
    await ingestion.ingest({
      ...native(now),
      seq: 2,
      window: {
        title: 'secret-a.ts',
        document: '/alpha/src/secret-a.ts',
      },
    })

    // Raw TTL expiry compacts the newest observation; a conservative
    // app-scope forget then removes the app's remaining raw evidence
    // and the derived episodes it can no longer prove complete.
    primary.db.prepare(
      'DELETE FROM observations WHERE collector_seq = 2',
    ).run()
    new DeletionService(secondary.db).delete({
      scope: { kind: 'app', bundleId: 'com.microsoft.VSCode' },
    }, now)

    ingestion.reseed()
    now += 5_000
    await ingestion.ingest({
      ...native(now),
      seq: 3,
      window: {
        title: 'plain-b.ts',
        document: '/alpha/src/plain-b.ts',
      },
    })

    const episodes = new EpisodeStore(primary.db).listRecent()
    expect(episodes).toHaveLength(1)

    for (const episode of episodes) {
      const linked = primary.db.prepare(`
        SELECT COUNT(*) AS count
        FROM episode_observations
        WHERE episode_id = ?
      `).get(episode.id) as { count: number }
      const expected = primary.db.prepare(`
        SELECT COALESCE(SUM(observation_count), 0) AS count
        FROM episode_surfaces
        WHERE episode_id = ?
      `).get(episode.id) as { count: number }

      // Provenance must still be internally consistent, otherwise a
      // later targeted delete would trust a row it cannot rebuild.
      expect(Number(linked.count)).toBeGreaterThan(0)
      expect(Number(expected.count)).toBe(Number(linked.count))
    }

    // The forgotten resource must not survive in any derived artifact
    // the fresh, legitimate observation did not itself report.
    expect(JSON.stringify(episodes)).not.toContain('secret-a')
    expect(JSON.stringify(
      primary.db.prepare(
        'SELECT canonical_uri FROM resources',
      ).all(),
    )).not.toContain('secret-a')

    secondary.close()
    primary.close()
  })
})

describe('policy mutation ownership', () => {
  it('holds the capture lease until policy propagation finishes', async () => {
    const { primary, secondary } = openPair()
    secondary.close()
    const policies = new PolicyStore(primary.db)
    policies.ensureInitial(1)
    const order: string[] = []

    const backend = new LocalComputerHistoryBackend(
      new EpisodeStore(primary.db),
      policies,
      new DeletionService(primary.db),
      new NoopCapture(),      {
        observationRetentionHours: 24,
        episodeRetentionDays: 30,
        autoResume: false,
        acquirePolicyChangeLease: async () => {
          order.push('acquire')
          return async () => { order.push('release') }
        },
        onPolicyChanged: async () => {
          order.push('propagate')
        },
      },
    )

    await backend.replacePolicy({
      mode: 'include-only',
      rules: [],
    })

    expect(order).toEqual([
      'acquire',
      'propagate',
      'release',
    ])
    primary.close()
  })
})

describe('teardown versus in-flight ingestion', () => {
  it('serializes concurrent producers and keeps idle false until the whole queue settles', async () => {
    const { primary, secondary } = openPair()
    const policy = new PolicyStore(primary.db)
    allowCode(policy, 10)

    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    let firstEnteredResolve!: () => void
    const firstEntered = new Promise<void>(resolve => {
      firstEnteredResolve = resolve
    })
    let secondEntered = false
    let resolves = 0

    const ingestion = new IngestionService(
      primary.db,
      {
        resolve: async () => {
          resolves += 1
          if (resolves === 1) {
            firstEnteredResolve()
            await firstGate
          } else {
            secondEntered = true
          }
          return {
            id: 'alpha',
            root: '/alpha',
            title: 'alpha',
            source: 'dsh' as const,
            confidence: 1,
          }
        },
      },
      () => policy.get(),
      () => 4_000,
    )

    const first = ingestion.ingest(native(4_000))
    await firstEntered
    const second = ingestion.ingest({
      ...native(4_001),
      seq: 2,
      window: {
        title: 'second.ts',
        document: '/alpha/src/second.ts',
      },
    })

    // The second producer must not cross the first one's asynchronous resolver and enter the shared
    // SQLite transaction path. It stays queued until the first ingest completes.
    await Promise.resolve()
    expect(secondEntered).toBe(false)

    let idle = false
    void ingestion.whenIdle().then(() => { idle = true })
    await Promise.resolve()
    expect(idle).toBe(false)

    releaseFirst()
    expect(await Promise.all([first, second])).toEqual([true, true])
    await ingestion.whenIdle()
    expect(secondEntered).toBe(true)
    expect(idle).toBe(true)
    expect(new ObservationStore(primary.db).count()).toBe(2)

    secondary.close()
    primary.close()
  })

  it('reports an in-flight ingest as not idle until it settles', async () => {
    const { primary, secondary } = openPair()
    const policy = new PolicyStore(primary.db)
    allowCode(policy, 10)

    let releaseResolve!: () => void
    const gate = new Promise<void>(resolve => {
      releaseResolve = resolve
    })
    let enteredResolve!: () => void
    const entered = new Promise<void>(resolve => {
      enteredResolve = resolve
    })

    const ingestion = new IngestionService(
      primary.db,
      {
        resolve: async () => {
          enteredResolve()
          await gate
          return { source: 'none' as const, confidence: 0 }
        },
      },
      () => policy.get(),
      () => 4_000,
    )

    expect(await ingestion.whenIdle().then(() => 'idle'))
      .toBe('idle')

    const ingesting = ingestion.ingest(native(4_000))
    await entered

    // Teardown must be able to see that a write is still running: the
    // database is never closed underneath it.
    let settled = false
    void ingestion.whenIdle().then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseResolve()
    expect(await ingesting).toBe(true)
    await ingestion.whenIdle()
    expect(settled).toBe(true)

    secondary.close()
    primary.close()
  })
})
