import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PHASE1_ADAPTERS,
  PolicyRuleId,
  RETENTION_BOUNDS,
  type NativeObservation,
  type PolicySnapshot,
} from '../../src/shared/index.js'
import { IngestionService } from '../../src/host/ingestion/index.js'
import {
  DeletionService,
  RetentionService,
} from '../../src/host/retention/index.js'
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

function native(bundleId = 'com.microsoft.VSCode'): NativeObservation {
  return {
    v: 1,
    type: 'observation',
    collectorSession: 'live-1',
    seq: 1,
    observedAtMs: 1_000,
    app: { pid: 1, bundleId },
    window: {
      title: 'provider.ts',
      document: '/alpha/src/provider.ts',
    },
    privacy: { secure: false, protected: false },
    source: { adapter: 'vscode' },
  }
}

describe('live ingestion', () => {
  it('persists allowed metadata and derives a workspace episode', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-live-'))
    roots.push(root)
    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
      nowMs: 1,
    })
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    policies.replace('include-only', [{
      id: PolicyRuleId('allow-code'),
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: 'com.microsoft.VSCode',
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    }], 2)

    const ingestion = new IngestionService(
      history.db,
      {
        resolve: async () => ({
          id: 'alpha',
          root: '/alpha',
          title: 'alpha',
          source: 'dsh',
          confidence: 1,
        }),
      },
      () => policies.get(),
      () => 2_000,
    )

    expect(await ingestion.ingest(native())).toBe(true)
    expect(new ObservationStore(history.db).count()).toBe(1)
    const episodes = new EpisodeStore(history.db).listRecent()
    expect(episodes).toHaveLength(1)
    expect(episodes[0]).toMatchObject({
      workspace: { id: 'alpha' },
      summaryKind: 'deterministic',
    })
    history.close()
  })

  it('reseeds after another Host mutates the shared history database', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-live-'),
    )
    roots.push(root)
    const dataDirectory =
      path.join(root, 'history')
    const primary = openHistoryDatabase({
      dataDirectory,
      nowMs: 1,
    })
    const secondary = openHistoryDatabase({
      dataDirectory,
      nowMs: 1,
    })

    const policies = new PolicyStore(primary.db)
    policies.ensureInitial(1)
    policies.replace('include-only', [{
      id: PolicyRuleId('allow-code'),
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: 'com.microsoft.VSCode',
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    }], 2)

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
      () => policies.get(),
      () => 4_000,
    )

    expect(
      await ingestion.ingest(native()),
    ).toBe(true)

    new DeletionService(secondary.db).delete({
      scope: { kind: 'all' },
    }, 3_000)

    expect(
      new ObservationStore(primary.db).count(),
    ).toBe(0)

    expect(await ingestion.ingest({
      ...native(),
      seq: 2,
      observedAtMs: 4_000,
      window: {
        title: 'next.ts',
        document: '/alpha/src/next.ts',
      },
    })).toBe(true)

    const episodes =
      new EpisodeStore(primary.db).listRecent()
    expect(episodes).toHaveLength(1)
    expect(
      episodes[0]?.resources.map(
        item => item.canonicalUri,
      ),
    ).toEqual([
      'file:///alpha/src/next.ts',
    ])

    secondary.close()
    primary.close()
  })

  it('does not resurrect a pre-delete observation that arrives late', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-live-'),
    )
    roots.push(root)
    const dataDirectory =
      path.join(root, 'history')
    const primary = openHistoryDatabase({
      dataDirectory,
      nowMs: 1,
    })
    const secondary = openHistoryDatabase({
      dataDirectory,
      nowMs: 1,
    })

    const policies = new PolicyStore(primary.db)
    policies.ensureInitial(1)
    policies.replace('include-only', [{
      id: PolicyRuleId('allow-code'),
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: 'com.microsoft.VSCode',
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    }], 2)

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
      () => policies.get(),
      () => 4_000,
    )

    new DeletionService(secondary.db).delete({
      scope: { kind: 'all' },
    }, 3_000)

    expect(
      await ingestion.ingest(native()),
    ).toBe(false)
    expect(
      new ObservationStore(primary.db).count(),
    ).toBe(0)

    expect(await ingestion.ingest({
      ...native(),
      seq: 2,
      observedAtMs: 4_000,
    })).toBe(true)
    expect(
      new ObservationStore(primary.db).count(),
    ).toBe(1)

    secondary.close()
    primary.close()
  })

  it('keeps a deletion tombstone while an old observation is still admissible under a longer retention choice', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-live-'),
    )
    roots.push(root)
    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
      nowMs: 1,
    })
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    policies.replace('include-only', [{
      id: PolicyRuleId('allow-code'),
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: 'com.microsoft.VSCode',
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    }], 2)

    const hour = 3_600_000
    const deletedAt = 100 * hour
    new DeletionService(history.db).delete({
      scope: { kind: 'all' },
    }, deletedAt)

    // Twenty-five hours later the old implementation pruned this marker using
    // the 24-hour default, even though a 30-day retention setting still accepts
    // observations from before the deletion.
    new RetentionService(history.db).sweep(
      deletedAt + 25 * hour,
    )
    expect(history.db.prepare(
      'SELECT COUNT(*) AS count FROM deletion_log',
    ).get()).toEqual({ count: 1 })

    const now = deletedAt + 25 * hour
    const ingestion = new IngestionService(
      history.db,
      {
        resolve: async () => ({
          id: 'alpha',
          root: '/alpha',
          title: 'alpha',
          source: 'dsh',
          confidence: 1,
        }),
      },
      () => policies.get(),
      () => now,
      () => RETENTION_BOUNDS.observationRetentionHours.max * hour,
    )

    expect(await ingestion.ingest({
      ...native(),
      collectorSession: 'late-after-delete',
      observedAtMs: deletedAt - hour,
    })).toBe(false)
    expect(new ObservationStore(history.db).count()).toBe(0)
    history.close()
  })

  it('bounds episode tombstones instead of blocking unrelated late work', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-live-'),
    )
    roots.push(root)
    const dataDirectory = path.join(root, 'history')
    const primary = openHistoryDatabase({
      dataDirectory,
      nowMs: 1,
    })
    const secondary = openHistoryDatabase({
      dataDirectory,
      nowMs: 1,
    })

    const policies = new PolicyStore(primary.db)
    policies.ensureInitial(1)
    policies.replace('include-only', [{
      id: PolicyRuleId('allow-code'),
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: 'com.microsoft.VSCode',
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    }], 2)

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
      () => policies.get(),
      () => 4_000,
    )

    expect(await ingestion.ingest(native())).toBe(true)
    const episode = new EpisodeStore(primary.db)
      .listRecent()[0]
    expect(episode).toBeDefined()

    new DeletionService(secondary.db).delete({
      scope: {
        kind: 'episode',
        episodeId: episode!.id,
      },
    }, 3_000)

    expect(await ingestion.ingest({
      ...native(),
      seq: 2,
      observedAtMs: 1_000,
    })).toBe(false)

    expect(await ingestion.ingest({
      ...native(),
      seq: 3,
      observedAtMs: 2_000,
      window: {
        title: 'later.ts',
        document: '/alpha/src/later.ts',
      },
    })).toBe(true)

    expect(
      new ObservationStore(primary.db).count(),
    ).toBe(1)

    secondary.close()
    primary.close()
  })

  it('rechecks external mutations after workspace resolution', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-live-'),
    )
    roots.push(root)
    const dataDirectory = path.join(root, 'history')
    const primary = openHistoryDatabase({
      dataDirectory,
      nowMs: 1,
    })
    const secondary = openHistoryDatabase({
      dataDirectory,
      nowMs: 1,
    })

    const policies = new PolicyStore(primary.db)
    policies.ensureInitial(1)
    policies.replace('include-only', [{
      id: PolicyRuleId('allow-code'),
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: 'com.microsoft.VSCode',
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    }], 2)

    let deleteDuringResolve = false
    const ingestion = new IngestionService(
      primary.db,
      {
        resolve: async () => {
          if (deleteDuringResolve) {
            new DeletionService(secondary.db).delete({
              scope: { kind: 'all' },
            }, 3_000)
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
      () => policies.get(),
      () => 4_000,
    )

    expect(await ingestion.ingest(native())).toBe(true)
    deleteDuringResolve = true

    expect(await ingestion.ingest({
      ...native(),
      seq: 2,
      observedAtMs: 4_000,
      window: {
        title: 'after-delete.ts',
        document: '/alpha/src/after-delete.ts',
      },
    })).toBe(true)

    const episodes = new EpisodeStore(primary.db)
      .listRecent()
    expect(episodes).toHaveLength(1)
    expect(
      episodes[0]?.resources.map(
        resource => resource.canonicalUri,
      ),
    ).toEqual([
      'file:///alpha/src/after-delete.ts',
    ])

    secondary.close()
    primary.close()
  })

  it('preserves derived-only episodes during out-of-order repair after raw compaction', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-live-'),
    )
    roots.push(root)
    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
      nowMs: 1,
    })
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    policies.replace('include-only', [{
      id: PolicyRuleId('allow-code'),
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: 'com.microsoft.VSCode',
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    }], 2)

    let nowMs = 2_000
    const ingestion = new IngestionService(
      history.db,
      {
        resolve: async () => ({
          id: 'alpha',
          root: '/alpha',
          title: 'alpha',
          source: 'dsh',
          confidence: 1,
        }),
      },
      () => policies.get(),
      () => nowMs,
    )

    expect(await ingestion.ingest(native())).toBe(true)
    const episodes = new EpisodeStore(history.db)
    const oldEpisode = episodes.listRecent()[0]
    expect(oldEpisode).toBeDefined()

    history.db.prepare(
      'UPDATE observations SET expires_at_ms = 5_000',
    ).run()
    new RetentionService(history.db).sweep(10_000)
    ingestion.reseed()
    expect(new ObservationStore(history.db).count()).toBe(0)
    expect(episodes.get(oldEpisode!.id)).toBeDefined()

    nowMs = 21_000
    expect(await ingestion.ingest({
      ...native(),
      seq: 2,
      observedAtMs: 20_000,
      window: {
        title: 'newer.ts',
        document: '/alpha/src/newer.ts',
      },
    })).toBe(true)

    nowMs = 22_000
    expect(await ingestion.ingest({
      ...native(),
      seq: 3,
      observedAtMs: 19_000,
      window: {
        title: 'older-late.ts',
        document: '/alpha/src/older-late.ts',
      },
    })).toBe(true)

    expect(episodes.get(oldEpisode!.id)).toMatchObject({
      id: oldEpisode!.id,
      summary: oldEpisode!.summary,
    })
    const afterRepair = episodes.listRecent()
    expect(afterRepair).toHaveLength(2)
    expect(
      afterRepair.flatMap(episode =>
        episode.resources.map(resource => resource.canonicalUri),
      ),
    ).toEqual(expect.arrayContaining([
      'file:///alpha/src/provider.ts',
      'file:///alpha/src/older-late.ts',
      'file:///alpha/src/newer.ts',
    ]))

    history.close()
  })

  it('fails closed when a companion workspace alias resolves into a protected directory', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-workspace-alias-'),
    )
    roots.push(root)
    const protectedRoot = path.join(root, '.ssh')
    const alias = path.join(root, 'safe-project')
    mkdirSync(protectedRoot)
    symlinkSync(
      protectedRoot,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
      nowMs: 1,
    })
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    policies.replace('include-only', [{
      id: PolicyRuleId('allow-code'),
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: 'com.microsoft.VSCode',
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    }], 2)

    const ingestion = new IngestionService(
      history.db,
      { resolve: async () => ({ source: 'none' as const, confidence: 0 }) },
      () => policies.get(),
      () => 2_000,
    )

    expect(await ingestion.ingest({
      ...native(),
      collectorSession: 'workspace-alias',
      window: { title: 'Integrated Terminal' },
      workspace: {
        root: alias,
        title: 'safe-project',
      },
      source: {
        provider: 'companion',
        adapter: 'vscode',
      },
    })).toBe(false)
    expect(new ObservationStore(history.db).count()).toBe(0)
    history.close()
  })

  it('fails closed on protected canonical paths before workspace resolution', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-live-'),
    )
    roots.push(root)
    const secret = path.join(root, '.ssh')
    const alias = path.join(root, 'safe-cwd')
    mkdirSync(secret)
    symlinkSync(secret, alias, 'dir')

    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
      nowMs: 1,
    })
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    policies.replace('include-only', [{
      id: PolicyRuleId('allow-terminal'),
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: 'com.apple.Terminal',
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    }], 2)

    let resolutions = 0
    const ingestion = new IngestionService(
      history.db,
      {
        resolve: async () => {
          resolutions += 1
          return { source: 'none', confidence: 0 }
        },
      },
      () => policies.get(),
      () => 2_000,
    )

    expect(await ingestion.ingest({
      ...native(),
      app: { pid: 7, bundleId: 'com.apple.Terminal' },
      window: { title: 'shell', document: alias },
      source: { adapter: 'terminal' },
    })).toBe(false)
    expect(resolutions).toBe(0)
    expect(new ObservationStore(history.db).count()).toBe(0)
    history.close()
  })

  it('fails closed for unlisted and browser observations', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-live-'))
    roots.push(root)
    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
      nowMs: 1,
    })
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    const ingestion = new IngestionService(
      history.db,
      { resolve: async () => ({ source: 'none', confidence: 0 }) },
      () => policies.get(),
      () => 2_000,
    )
    expect(await ingestion.ingest(native('com.apple.Notes'))).toBe(false)

    policies.replace('include-only', [{
      id: PolicyRuleId('allow-chrome'),
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: 'com.google.Chrome',
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    }], 2)
    expect(await ingestion.ingest(native('com.google.Chrome'))).toBe(false)
    expect(new ObservationStore(history.db).count()).toBe(0)
    history.close()
  })
})

describe('repeated work on one file outside a DSH workspace', () => {
  // The live Phase 2.0 run produced this: three observations of the same file,
  // seconds apart, each in its own episode with the previous one closed as
  // "workspace-switch", although no workspace was ever observed. A workspace
  // resolved from the filesystem is deliberately not a strong workspace, so
  // those observations take the non-owned resource path.
  it('keeps one episode for repeated observations of the same resource', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-live-fs-'))
    roots.push(root)
    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
      nowMs: 1,
    })
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    policies.replace('include-only', [{
      id: PolicyRuleId('allow-code-fs'),
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: 'com.microsoft.VSCode',
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    }], 2)

    const ingestion = new IngestionService(
      history.db,
      {
        // A filesystem workspace: not `dsh`/`git`, so the episode is not owned
        // by it.
        resolve: async () => ({
          root: '/private/tmp/dsh-live-fixtures',
          title: 'dsh-live-fixtures',
          source: 'filesystem',
          confidence: 0.4,
        }),
      },
      () => policies.get(),
      () => 100_000,
    )

    const base = native()
    expect(await ingestion.ingest({
      ...base,
      seq: 1,
      observedAtMs: 10_000,
    })).toBe(true)
    expect(await ingestion.ingest({
      ...base,
      seq: 2,
      observedAtMs: 15_900,
    })).toBe(true)
    expect(await ingestion.ingest({
      ...base,
      seq: 3,
      observedAtMs: 25_000,
    })).toBe(true)

    const episodes = new EpisodeStore(history.db).listRecent()
    expect(episodes).toHaveLength(1)
    const detail = new EpisodeStore(history.db).get(episodes[0]!.id)
    expect(detail?.observationIds).toHaveLength(3)
    history.close()
  })
})

describe('every adapter in the table can be stored', () => {
  // A copied adapter list in the store's payload validator silently rejected
  // observations from adapters added after it was written (xcode, word, wps,
  // jetbrains). Collector-side probes cannot see that: they never reach the
  // store. This walks the shared table instead, so a new adapter has to work
  // end to end.
  it('ingests one observation per shared adapter entry', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-all-adapters-'))
    roots.push(root)
    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
      nowMs: 1,
    })
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    policies.replace('include-only', PHASE1_ADAPTERS.map((entry, index) => ({
      id: PolicyRuleId(`allow-${entry.id}`),
      dimension: 'app' as const,
      action: 'allow' as const,
      matcher: 'exact' as const,
      pattern: entry.bundleIds[0]!,
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1 + index,
    })), 2)

    const ingestion = new IngestionService(
      history.db,
      { resolve: async () => ({ source: 'none' as const, confidence: 0 }) },
      () => policies.get(),
      () => 100_000,
    )

    let seq = 0
    for (const entry of PHASE1_ADAPTERS) {
      seq += 1
      // Sequential on purpose: ingestion is stateful (collector sequence
      // ordering, incremental episode builder), so the adapters must be
      // exercised one after another rather than in parallel.
      // eslint-disable-next-line no-await-in-loop
      const stored = await ingestion.ingest({
        ...native(entry.bundleIds[0]!),
        seq,
        observedAtMs: 10_000 + seq * 1_000,
        source: { adapter: entry.id },
      })
      expect(stored, `adapter ${entry.id} (${entry.bundleIds[0]})`).toBe(true)
    }

    expect(new ObservationStore(history.db).count()).toBe(PHASE1_ADAPTERS.length)
    history.close()
  })
})

function browserIngestionService(root: string) {
    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
      nowMs: 1,
    })
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    policies.replace('include-only', [{
      id: PolicyRuleId('allow-browser'),
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: 'companion.browser',
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    }], 2)
    return {
      history,
      policies,
      ingestion: new IngestionService(
        history.db,
        { resolve: async () => ({ source: 'none' as const, confidence: 0 }) },
        () => policies.get(),
        () => 100_000,
      ),
    }
}

describe('URL resources are provenance-gated (ADR 0007)', () => {
  it('still drops a URL that came through Accessibility', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-url-ax-'))
    roots.push(root)
    const { history, ingestion } = browserIngestionService(root)
    expect(await ingestion.ingest({
      ...native('com.microsoft.VSCode'),
      window: { title: 'A page', url: 'https://example.test/private?token=abc' },
      source: { adapter: 'vscode' },
    })).toBe(false)
    expect(new ObservationStore(history.db).count()).toBe(0)
    history.close()
  })

  it('stores a companion URL without its query string or fragment', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-url-companion-'))
    roots.push(root)
    const { history, ingestion } = browserIngestionService(root)
    expect(await ingestion.ingest({
      ...native('companion.browser'),
      window: {
        title: 'Example page',
        url: 'https://example.test/docs/guide?token=secret#section-3',
      },
      source: { provider: 'companion', adapter: 'browser' },
    })).toBe(true)

    const observations = new ObservationStore(history.db).listAll()
    expect(observations).toHaveLength(1)
    expect(observations[0]!.resource).toMatchObject({
      kind: 'url',
      canonicalUri: 'https://example.test/docs/guide',
      displayLabel: 'Example page',
    })
    expect(observations[0]!.source.provider).toBe('companion')
    expect(String(observations[0]!.resource?.canonicalUri)).not.toContain('secret')
    history.close()
  })
})

function protectService(root: string, protectRules: boolean) {
  const history = openHistoryDatabase({
    dataDirectory: path.join(root, 'history'),
    nowMs: 1,
  })
  const now = Date.now()
  // Built by hand: these cases are about the normaliser's decision, not about
  // how a policy is persisted, and the built-in protect rules an initial
  // policy carries would only obscure which rule did the dropping.
  const snapshot: PolicySnapshot = {
    revision: 2,
    mode: 'include-only',
    updatedAtMs: now,
    rules: [
      {
        id: PolicyRuleId('allow-vscode'),
        dimension: 'app',
        action: 'allow',
        matcher: 'exact',
        pattern: 'com.microsoft.VSCode',
        builtIn: false,
        createdAtMs: now,
        updatedAtMs: now,
      },
      ...(protectRules
        ? [{
            id: PolicyRuleId('protect-client'),
            dimension: 'resource' as const,
            action: 'deny' as const,
            matcher: 'glob' as const,
            pattern: '/Users/someone/private/*',
            builtIn: false,
            createdAtMs: now,
            updatedAtMs: now,
          }]
        : []),
    ],
  }
  return {
    history,
    snapshot,
    ingestion: new IngestionService(
      history.db,
      { resolve: async () => ({ source: 'none' as const, confidence: 0 }) },
      () => snapshot,
      () => 100_000,
    ),
  }
}

describe('F13: a file name we cannot locate is not stored (ADR 0008)', () => {
  // A window that offers only its file name: no document, no URL.
  function titleOnly(title: string): NativeObservation {
    return {
      ...native(),
      window: { title },
    }
  }

  it('stores a bare file name when no path is protected', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-f13-open-'))
    roots.push(root)
    const { history, ingestion } = protectService(root, false)
    expect(await ingestion.ingest(titleOnly('notes.txt'))).toBe(true)
    expect(new ObservationStore(history.db).count()).toBe(1)
    history.close()
  })

  it('drops it once a protected path exists, because it cannot be located', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-f13-protected-'))
    roots.push(root)
    const { history, ingestion } = protectService(root, true)
    expect(await ingestion.ingest(titleOnly('notes.txt'))).toBe(false)
    expect(new ObservationStore(history.db).count()).toBe(0)
    history.close()
  })

  it('keeps a titled window that is more than a file name', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-f13-titled-'))
    roots.push(root)
    const { history, ingestion } = protectService(root, true)
    // Distinct collector sequences: the same (session, seq) twice is a
    // duplicate, which would drop the second for an unrelated reason.
    expect(await ingestion.ingest({ ...titleOnly('notes.txt — Editor'), seq: 11 })).toBe(true)
    expect(await ingestion.ingest({ ...titleOnly('Doing the thing'), seq: 12 })).toBe(true)
    expect(new ObservationStore(history.db).count()).toBe(2)
    history.close()
  })

  it('leaves a window with a readable document alone', async () => {
    // The rule only reaches names the Host cannot place; a document that the
    // policy does not protect is stored exactly as before.
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-f13-document-'))
    roots.push(root)
    const { history, ingestion } = protectService(root, true)
    expect(await ingestion.ingest({
      ...native(),
      window: { title: 'provider.ts', document: '/alpha/src/provider.ts' },
    })).toBe(true)
    expect(new ObservationStore(history.db).count()).toBe(1)
    history.close()
  })
})
