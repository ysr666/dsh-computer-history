import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CollectorSessionId,
  EpisodeId,
  type ActivityObservation,
} from '../../src/shared/index.js'
import {
  EpisodeStore,
  ObservationStore,
  openHistoryDatabase,
  ResourceStore,
} from '../../src/host/store/index.js'

const roots: string[] = []

function openTempDatabase() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-episode-'))
  roots.push(root)
  return openHistoryDatabase({
    dataDirectory: path.join(root, 'history'),
    nowMs: 1,
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function observation(seq: number, uri: string): ActivityObservation {
  return {
    collectorSessionId: CollectorSessionId('collector-1'),
    seq,
    observedAtMs: 10_000 + seq,
    app: {
      pid: 123,
      bundleId: 'com.microsoft.VSCode',
      displayName: 'Code',
    },
    surface: {
      kind: 'editor',
      title: path.basename(uri),
    },
    resource: {
      kind: 'file',
      canonicalUri: uri,
      displayLabel: path.basename(uri),
    },
    workspace: {
      id: 'workspace-1',
      root: '/repo',
      title: 'repo',
      source: 'dsh',
      confidence: 1,
    },
    activity: {},
    privacy: {
      secure: false,
      protected: false,
    },
    source: {
      provider: 'macos-ax',
      adapter: 'vscode',
    },
    policyRevision: 1,
    expiresAtMs: 90_000,
  }
}

describe('episode store', () => {
  it('reads app-switch as a valid persisted boundary reason', () => {
    const history = openTempDatabase()
    const episodes = new EpisodeStore(history.db)

    history.db.prepare(`
      INSERT INTO episodes(
        id, started_at_ms, ended_at_ms, start_reason, end_reason,
        summary_kind, summary_text, confidence, state, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'episode-app-switch',
      10_000,
      11_000,
      'first-observation',
      'app-switch',
      'deterministic',
      'Switched applications.',
      1,
      'closed',
      11_000,
      11_000,
    )

    expect(episodes.listRecent({ limit: 1 })[0]?.boundary).toEqual({
      startReason: 'first-observation',
      endReason: 'app-switch',
    })
    history.close()
  })

  it('persists provenance, resources, surfaces, and last strong resource', () => {
    const history = openTempDatabase()
    const resources = new ResourceStore(history.db)
    const observations = new ObservationStore(history.db)
    const episodes = new EpisodeStore(history.db)

    const first = observation(1, 'file:///repo/src/provider.ts')
    const second = observation(2, 'file:///repo/src/other.ts')
    const firstResource = resources.upsert(first.resource!, first.observedAtMs)
    const secondResource = resources.upsert(second.resource!, second.observedAtMs)
    const firstObservation = observations.insert(first, firstResource)
    const secondObservation = observations.insert(second, secondResource)

    const episodeId = EpisodeId('episode-1')
    episodes.replace({
      id: episodeId,
      startedAtMs: first.observedAtMs,
      endedAtMs: second.observedAtMs,
      startReason: 'first-observation',
      endReason: 'timeout',
      workspace: {
        id: 'workspace-1',
        root: '/repo',
        title: 'repo',
      },
      threadKey: 'workspace:workspace-1',
      lastStrongResourceId: secondResource,
      summaryKind: 'deterministic',
      summary: 'Worked in repo.',
      confidence: 1,
      state: 'closed',
      createdAtMs: 20_000,
      updatedAtMs: 20_000,
      expiresAtMs: 100_000,
      observationIds: [firstObservation, secondObservation],
    })

    expect(episodes.get(episodeId)).toEqual({
      id: episodeId,
      startedAtMs: first.observedAtMs,
      endedAtMs: second.observedAtMs,
      boundary: {
        startReason: 'first-observation',
        endReason: 'timeout',
      },
      workspace: {
        id: 'workspace-1',
        root: '/repo',
        title: 'repo',
      },
      threadKey: 'workspace:workspace-1',
      summaryKind: 'deterministic',
      summary: 'Worked in repo.',
      // A summary's citations are the observations it was derived from
      // (ADR 0004 §5); the store derives them from the episode's own set.
      summaryObservationIds: [firstObservation, secondObservation],
      lastStrongResource: {
        kind: 'file',
        canonicalUri: 'file:///repo/src/other.ts',
        displayLabel: 'other.ts',
        firstSeenAtMs: second.observedAtMs,
        lastSeenAtMs: second.observedAtMs,
        observationCount: 1,
      },
      confidence: 1,
      state: 'closed',
      observationIds: [firstObservation, secondObservation],
      // Aggregates are derived from the linked observations, so the
      // counters can never disagree with what deletion treats as
      // complete provenance.
      resources: [
        {
          kind: 'file',
          canonicalUri: 'file:///repo/src/provider.ts',
          displayLabel: 'provider.ts',
          firstSeenAtMs: first.observedAtMs,
          lastSeenAtMs: first.observedAtMs,
          observationCount: 1,
        },
        {
          kind: 'file',
          canonicalUri: 'file:///repo/src/other.ts',
          displayLabel: 'other.ts',
          firstSeenAtMs: second.observedAtMs,
          lastSeenAtMs: second.observedAtMs,
          observationCount: 1,
        },
      ],
      surfaces: [{
        bundleId: 'com.microsoft.VSCode',
        surfaceKind: 'editor',
        // The surface carries the newest title it saw: the second observation was `other.ts`. An adapter that
        // suppresses its titles contributes none, which is asserted in tests/unit/episode-surface-title.spec.ts.
        title: 'other.ts',
        firstSeenAtMs: first.observedAtMs,
        lastSeenAtMs: second.observedAtMs,
        observationCount: 2,
      }],
    })

    history.close()
  })

  it('replaces derived provenance atomically for the same episode id', () => {
    const history = openTempDatabase()
    const resources = new ResourceStore(history.db)
    const observations = new ObservationStore(history.db)
    const episodes = new EpisodeStore(history.db)

    const first = observation(1, 'file:///repo/src/provider.ts')
    const second = observation(2, 'file:///repo/src/other.ts')
    const firstResource = resources.upsert(first.resource!, first.observedAtMs)
    const secondResource = resources.upsert(second.resource!, second.observedAtMs)
    const firstObservation = observations.insert(first, firstResource)
    const secondObservation = observations.insert(second, secondResource)
    const id = EpisodeId('episode-1')

    const common = {
      id,
      startedAtMs: first.observedAtMs,
      startReason: 'first-observation' as const,
      endReason: 'manual-rebuild' as const,
      workspace: { id: 'workspace-1' },
      summaryKind: 'deterministic' as const,
      summary: 'Worked in repo.',
      confidence: 1,
      state: 'closed' as const,
      createdAtMs: 20_000,
      updatedAtMs: 20_000,
      expiresAtMs: 100_000,
          }

    episodes.replace({
      ...common,
      endedAtMs: first.observedAtMs,
      observationIds: [firstObservation],
          })

    episodes.replace({
      ...common,
      endedAtMs: second.observedAtMs,
      updatedAtMs: 30_000,
      observationIds: [secondObservation],
          })

    expect(episodes.get(id)?.observationIds).toEqual([secondObservation])
    expect(episodes.get(id)?.resources.map((item) => item.canonicalUri)).toEqual([
      'file:///repo/src/other.ts',
    ])

    history.close()
  })

  it('carries the surface title through an append, and keeps the last one', () => {
    const history = openTempDatabase()
    const resources = new ResourceStore(history.db)
    const observations = new ObservationStore(history.db)
    const episodes = new EpisodeStore(history.db)

    const first = observation(1, 'file:///repo/src/provider.ts')
    const second = observation(2, 'file:///repo/src/other.ts')
    const resourceId = resources.upsert(first.resource!, first.observedAtMs)
    const secondResourceId = resources.upsert(second.resource!, second.observedAtMs)
    const firstId = observations.insert(first, resourceId)
    const secondId = observations.insert(second, secondResourceId)

    const id = EpisodeId('episode-title-append')
    const base = {
      id,
      startedAtMs: first.observedAtMs,
      startReason: 'first-observation' as const,
      endReason: 'timeout' as const,
      workspace: { id: 'workspace-1' },
      lastStrongResourceId: secondResourceId,
      summaryKind: 'deterministic' as const,
      summary: 'Worked in repo.',
      confidence: 1,
      state: 'closed' as const,
      createdAtMs: 20_000,
      expiresAtMs: 100_000,
    }
    episodes.replace({
      ...base,
      endedAtMs: first.observedAtMs,
      updatedAtMs: 20_000,
      observationIds: [firstId],
    })
    expect(episodes.get(id)?.surfaces.at(0)?.title).toBe('provider.ts')

    // The append path is a separate statement from the rebuild path, so the title has to travel through it
    // on its own - this is the assertion that fails if only one of the two was taught about titles.
    episodes.replace({
      ...base,
      endedAtMs: second.observedAtMs,
      updatedAtMs: 30_000,
      observationIds: [firstId, secondId],
    }, {
      provenance: 'append',
      appendObservationIds: [secondId],
    })
    expect(episodes.get(id)?.surfaces.at(0)?.title).toBe('other.ts')
    history.close()
  })

  it('increments append-mode resource and surface provenance from observation deltas', () => {
    const history = openTempDatabase()
    const resources = new ResourceStore(history.db)
    const observations = new ObservationStore(history.db)
    const episodes = new EpisodeStore(history.db)
    const first = observation(1, 'file:///repo/src/provider.ts')
    const second = observation(2, 'file:///repo/src/provider.ts')
    const resourceId = resources.upsert(
      first.resource!,
      first.observedAtMs,
    )
    resources.upsert(second.resource!, second.observedAtMs)
    const firstId = observations.insert(first, resourceId)
    const secondId = observations.insert(second, resourceId)
    const id = EpisodeId('episode-append')
    const base = {
      id,
      startedAtMs: first.observedAtMs,
      startReason: 'first-observation' as const,
      endReason: 'timeout' as const,
      workspace: { id: 'workspace-1' },
      lastStrongResourceId: resourceId,
      summaryKind: 'deterministic' as const,
      summary: 'Worked in repo.',
      confidence: 1,
      state: 'closed' as const,
      createdAtMs: 20_000,
      expiresAtMs: 100_000,
            }

    // The Episode must have real provenance before anything can be
    // appended to it: an "append" onto a row with no links would claim
    // derived content while linking none of the evidence behind it.
    episodes.replace({
      ...base,
      endedAtMs: first.observedAtMs,
      updatedAtMs: 20_000,
      observationIds: [firstId],
            })
    episodes.replace({
      ...base,
      endedAtMs: second.observedAtMs,
      updatedAtMs: 30_000,
      observationIds: [firstId, secondId],
    }, {
      provenance: 'append',
      appendObservationIds: [secondId],
    })

    expect(episodes.get(id)).toMatchObject({
      observationIds: [firstId, secondId],
            })
    history.close()
  })

  it('keeps aggregates equal to links even when an append is requested for diverged provenance', () => {
    const history = openTempDatabase()
    const resources = new ResourceStore(history.db)
    const observations = new ObservationStore(history.db)
    const episodes = new EpisodeStore(history.db)

    const first = observation(1, 'file:///repo/src/provider.ts')
    const third = observation(3, 'file:///repo/src/later.ts')
    const firstResource = resources.upsert(first.resource!, first.observedAtMs)
    const thirdResource = resources.upsert(third.resource!, third.observedAtMs)
    const firstId = observations.insert(first, firstResource)
    const thirdId = observations.insert(third, thirdResource)

    const id = EpisodeId('episode-diverged')
    const base = {
      id,
      startedAtMs: first.observedAtMs,
      startReason: 'first-observation' as const,
      endReason: 'timeout' as const,
      summaryKind: 'deterministic' as const,
      summary: 'Worked in repo.',
      confidence: 1,
      state: 'closed' as const,
      createdAtMs: 20_000,
      updatedAtMs: 20_000,
      expiresAtMs: 100_000,
    }

    episodes.replace({
      ...base,
      endedAtMs: first.observedAtMs,
      observationIds: [firstId],
    })

    // The stored links [1] are not a prefix of the requested [1, 3]:
    // this Episode was re-derived from evidence it no longer links, so
    // an append would leave the aggregate counters describing a
    // different set of observations than the link table.
    episodes.replace({
      ...base,
      endedAtMs: third.observedAtMs,
      updatedAtMs: 30_000,
      observationIds: [firstId, thirdId],
    }, {
      provenance: 'append',
      appendObservationIds: [thirdId],
    })

    const detail = episodes.get(id)
    const linked = history.db.prepare(
      'SELECT COUNT(*) AS count FROM episode_observations WHERE episode_id = ?',
    ).get(id) as { count: number }
    const expected = history.db.prepare(
      'SELECT COALESCE(SUM(observation_count), 0) AS count FROM episode_surfaces WHERE episode_id = ?',
    ).get(id) as { count: number }

    expect(detail?.observationIds).toEqual([firstId, thirdId])
    expect(Number(linked.count)).toBe(2)
    expect(Number(expected.count)).toBe(Number(linked.count))
    expect(detail?.surfaces).toHaveLength(1)
    expect(detail?.surfaces[0]?.observationCount).toBe(2)

    history.close()
  })

  it('restores full provenance when an incremental append finds none left', () => {
    const history = openTempDatabase()
    const resources = new ResourceStore(history.db)
    const observations = new ObservationStore(history.db)
    const episodes = new EpisodeStore(history.db)

    const first = observation(1, 'file:///repo/src/provider.ts')
    const second = observation(2, 'file:///repo/src/second.ts')
    const firstResource = resources.upsert(first.resource!, first.observedAtMs)
    const secondResource = resources.upsert(second.resource!, second.observedAtMs)
    const firstId = observations.insert(first, firstResource)
    const secondId = observations.insert(second, secondResource)

    const id = EpisodeId('episode-restored')
    const base = {
      id,
      startedAtMs: first.observedAtMs,
      startReason: 'first-observation' as const,
      endReason: 'timeout' as const,
      summaryKind: 'deterministic' as const,
      summary: 'Worked in repo.',
      confidence: 1,
      state: 'closed' as const,
      createdAtMs: 20_000,
      updatedAtMs: 20_000,
      expiresAtMs: 100_000,
    }

    episodes.replace({
      ...base,
      endedAtMs: first.observedAtMs,
      observationIds: [firstId],
    })

    // Model the state a conservative forget leaves behind: the Episode
    // row survives but the provenance it was derived from is gone.
    history.db.prepare(
      'DELETE FROM episode_observations WHERE episode_id = ?',
    ).run(id)
    history.db.prepare(
      'DELETE FROM episode_resources WHERE episode_id = ?',
    ).run(id)
    history.db.prepare(
      'DELETE FROM episode_surfaces WHERE episode_id = ?',
    ).run(id)

    // The caller supplies only the delta, as the ingestion fast path
    // does. This Episode lost the provenance it was derived from, so
    // the append must be abandoned: blindly writing the delta would
    // claim content while linking none of the evidence behind it.
    episodes.replace({
      ...base,
      endedAtMs: second.observedAtMs,
      updatedAtMs: 30_000,
      observationIds: [firstId, secondId],
    }, {
      provenance: 'append',
      appendObservationIds: [secondId],
    })

    const linked = history.db.prepare(
      'SELECT COUNT(*) AS count FROM episode_observations WHERE episode_id = ?',
    ).get(id) as { count: number }
    const expected = history.db.prepare(
      'SELECT COALESCE(SUM(observation_count), 0) AS count FROM episode_surfaces WHERE episode_id = ?',
    ).get(id) as { count: number }

    expect(Number(linked.count)).toBe(2)
    expect(Number(expected.count)).toBe(2)
    expect(episodes.get(id)?.surfaces[0]?.observationCount).toBe(2)

    history.close()
  })

  it('counts only the links an append actually created', () => {
    const history = openTempDatabase()
    const resources = new ResourceStore(history.db)
    const observations = new ObservationStore(history.db)
    const episodes = new EpisodeStore(history.db)

    const first = observation(1, 'file:///repo/src/a.ts')
    const second = observation(2, 'file:///repo/src/b.ts')
    const third = observation(3, 'file:///repo/src/c.ts')
    const firstResource = resources.upsert(first.resource!, first.observedAtMs)
    const secondResource = resources.upsert(second.resource!, second.observedAtMs)
    const thirdResource = resources.upsert(third.resource!, third.observedAtMs)
    const firstId = observations.insert(first, firstResource)
    const secondId = observations.insert(second, secondResource)
    const thirdId = observations.insert(third, thirdResource)

    const id = EpisodeId('episode-idempotent-append')
    const base = {
      id,
      startedAtMs: first.observedAtMs,
      startReason: 'first-observation' as const,
      endReason: 'timeout' as const,
      summaryKind: 'deterministic' as const,
      summary: 'Worked in repo.',
      confidence: 1,
      state: 'closed' as const,
      createdAtMs: 20_000,
      updatedAtMs: 20_000,
      expiresAtMs: 100_000,
    }

    episodes.replace({
      ...base,
      endedAtMs: second.observedAtMs,
      observationIds: [firstId, secondId],
    })

    // A retry lists an identity that is already linked. Counting it
    // again would push the surface total past the link count and leave
    // the Episode permanently certified as incompletely provenanced.
    episodes.replace({
      ...base,
      endedAtMs: third.observedAtMs,
      updatedAtMs: 30_000,
      observationIds: [firstId, secondId, thirdId],
    }, {
      provenance: 'append',
      appendObservationIds: [secondId, thirdId],
    })

    const linked = history.db.prepare(
      'SELECT COUNT(*) AS count FROM episode_observations WHERE episode_id = ?',
    ).get(id) as { count: number }
    const expected = history.db.prepare(
      'SELECT COALESCE(SUM(observation_count), 0) AS count FROM episode_surfaces WHERE episode_id = ?',
    ).get(id) as { count: number }

    expect(Number(linked.count)).toBe(3)
    expect(Number(expected.count)).toBe(3)

    history.close()
  })

  it('fails loud when an append would regress episode provenance', () => {
    const history = openTempDatabase()
    const resources = new ResourceStore(history.db)
    const observations = new ObservationStore(history.db)
    const episodes = new EpisodeStore(history.db)

    const first = observation(1, 'file:///repo/src/a.ts')
    const second = observation(2, 'file:///repo/src/b.ts')
    const firstResource = resources.upsert(first.resource!, first.observedAtMs)
    const secondResource = resources.upsert(second.resource!, second.observedAtMs)
    const firstId = observations.insert(first, firstResource)
    const secondId = observations.insert(second, secondResource)

    const id = EpisodeId('episode-regressed')
    const base = {
      id,
      startedAtMs: first.observedAtMs,
      startReason: 'first-observation' as const,
      endReason: 'timeout' as const,
      summaryKind: 'deterministic' as const,
      summary: 'Worked in repo.',
      confidence: 1,
      state: 'closed' as const,
      createdAtMs: 20_000,
      updatedAtMs: 20_000,
      expiresAtMs: 100_000,
    }

    episodes.replace({
      ...base,
      endedAtMs: second.observedAtMs,
      observationIds: [firstId, secondId],
    })

    // The caller now claims a shorter history than what is linked.
    // Silently accepting it would update the Episode row while leaving
    // its provenance describing a different set of observations.
    expect(() => episodes.replace({
      ...base,
      endedAtMs: first.observedAtMs,
      updatedAtMs: 30_000,
      observationIds: [firstId],
    }, {
      provenance: 'append',
      appendObservationIds: [],
    })).toThrow(/provenance regressed/)

    const linked = history.db.prepare(
      'SELECT COUNT(*) AS count FROM episode_observations WHERE episode_id = ?',
    ).get(id) as { count: number }
    const expected = history.db.prepare(
      'SELECT COALESCE(SUM(observation_count), 0) AS count FROM episode_surfaces WHERE episode_id = ?',
    ).get(id) as { count: number }
    expect(Number(linked.count)).toBe(Number(expected.count))

    history.close()
  })

  it('cascades episode provenance rows when the episode is deleted', () => {
    const history = openTempDatabase()
    const episodes = new EpisodeStore(history.db)
    const id = EpisodeId('episode-empty')

    episodes.replace({
      id,
      startedAtMs: 1,
      endedAtMs: 2,
      startReason: 'first-observation',
      endReason: 'timeout',
      summaryKind: 'deterministic',
      summary: 'No resource.',
      confidence: 0.4,
      state: 'closed',
      createdAtMs: 2,
      updatedAtMs: 2,
      observationIds: [],
            })

    expect(episodes.delete(id)).toBe(true)
    expect(episodes.get(id)).toBeUndefined()

    for (const table of [
      'episode_observations',
      'episode_resources',
      'episode_surfaces',
    ]) {
      const row = history.db.prepare(
        `SELECT COUNT(*) AS count FROM ${table}`,
      ).get() as { count: number }
      expect(Number(row.count)).toBe(0)
    }

    history.close()
  })
})

describe('an episode is rewritten atomically', () => {
  it('rolls the links back when the citation rewrite fails', () => {
    const { db, close } = openTempDatabase()
    const observations = new ObservationStore(db)
    const resources = new ResourceStore(db)
    const episodes = new EpisodeStore(db)

    const first = observation(1, 'file:///repo/a.ts')
    const second = observation(2, 'file:///repo/b.ts')
    const firstResource = resources.upsert(first.resource!, first.observedAtMs)
    const secondResource = resources.upsert(second.resource!, second.observedAtMs)
    const firstObservation = observations.insert(first, firstResource)
    const secondObservation = observations.insert(second, secondResource)

    const id = EpisodeId('atomic-episode')
    const common = {
      id,
      startedAtMs: first.observedAtMs,
      startReason: 'first-observation' as const,
      endReason: 'timeout' as const,
      workspace: { id: 'workspace-1' },
      summaryKind: 'deterministic' as const,
      summary: 'Worked in repo.',
      confidence: 1,
      state: 'closed' as const,
      createdAtMs: 20_000,
      updatedAtMs: 20_000,
      expiresAtMs: 100_000,
    }

    episodes.replace({
      ...common,
      endedAtMs: first.observedAtMs,
      observationIds: [firstObservation],
      summaryObservationIds: [firstObservation],
    })
    expect(episodes.get(id)?.summaryObservationIds).toEqual([firstObservation])

    // The citation rewrite points at an observation that does not exist, so it
    // fails. Whatever the store committed before that failure is what a crash
    // between the two writes would also leave behind - and the only acceptable
    // outcome is the state from before the call.
    expect(() => episodes.replace({
      ...common,
      endedAtMs: second.observedAtMs,
      updatedAtMs: 30_000,
      observationIds: [firstObservation, secondObservation],
      summaryObservationIds: [999_999 as never],
    })).toThrow()

    const after = episodes.get(id)
    expect(after?.summaryObservationIds).toEqual([firstObservation])
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM episode_observations WHERE episode_id = ?')
        .get(String(id)),
    ).toEqual({ n: 1 })
    close()
  })
})
