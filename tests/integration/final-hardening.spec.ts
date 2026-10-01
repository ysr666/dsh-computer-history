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
  public getState() {
    return {
      enabled: true,
      capture: 'running' as const,
      accessibilityTrusted: true,
    }
  }
}

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
