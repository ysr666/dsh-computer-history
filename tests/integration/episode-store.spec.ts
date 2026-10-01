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
      resources: [
        {
          resourceId: firstResource,
          firstSeenAtMs: first.observedAtMs,
          lastSeenAtMs: first.observedAtMs,
          observationCount: 1,
        },
        {
          resourceId: secondResource,
          firstSeenAtMs: second.observedAtMs,
          lastSeenAtMs: second.observedAtMs,
          observationCount: 1,
        },
      ],
      surfaces: [{
        bundleId: 'com.microsoft.VSCode',
        surfaceKind: 'editor',
        firstSeenAtMs: first.observedAtMs,
        lastSeenAtMs: second.observedAtMs,
        observationCount: 2,
      }],
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
      lastStrongResource: {
        kind: 'file',
        canonicalUri: 'file:///repo/src/other.ts',
        displayLabel: 'other.ts',
        firstSeenAtMs: second.observedAtMs,
        lastSeenAtMs: second.observedAtMs,
        observationCount: 1,
      },
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
        firstSeenAtMs: first.observedAtMs,
        lastSeenAtMs: second.observedAtMs,
        observationCount: 2,
      }],
      confidence: 1,
      state: 'closed',
      observationIds: [firstObservation, secondObservation],
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
      surfaces: [],
    }

    episodes.replace({
      ...common,
      endedAtMs: first.observedAtMs,
      observationIds: [firstObservation],
      resources: [{
        resourceId: firstResource,
        firstSeenAtMs: first.observedAtMs,
        lastSeenAtMs: first.observedAtMs,
        observationCount: 1,
      }],
    })

    episodes.replace({
      ...common,
      endedAtMs: second.observedAtMs,
      updatedAtMs: 30_000,
      observationIds: [secondObservation],
      resources: [{
        resourceId: secondResource,
        firstSeenAtMs: second.observedAtMs,
        lastSeenAtMs: second.observedAtMs,
        observationCount: 1,
      }],
    })

    expect(episodes.get(id)?.observationIds).toEqual([secondObservation])
    expect(episodes.get(id)?.resources.map((item) => item.canonicalUri)).toEqual([
      'file:///repo/src/other.ts',
    ])

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
      resources: [],
      surfaces: [],
    }

    episodes.replace({
      ...base,
      endedAtMs: first.observedAtMs,
      updatedAtMs: 20_000,
      observationIds: [firstId],
    }, {
      provenance: 'append',
      appendObservationIds: [firstId],
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
      resources: [{
        firstSeenAtMs: first.observedAtMs,
        lastSeenAtMs: second.observedAtMs,
        observationCount: 2,
      }],
      surfaces: [{
        firstSeenAtMs: first.observedAtMs,
        lastSeenAtMs: second.observedAtMs,
        observationCount: 2,
      }],
    })
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
      resources: [],
      surfaces: [],
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
