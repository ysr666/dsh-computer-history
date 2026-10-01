import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CollectorSessionId, EpisodeId, type ActivityObservation } from '../../src/shared/index.js'
import { RetentionService } from '../../src/host/retention/index.js'
import { EpisodeStore, ObservationStore, openHistoryDatabase, ResourceStore } from '../../src/host/store/index.js'

const roots: string[] = []
function openTempDatabase() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-retention-'))
  roots.push(root)
  return openHistoryDatabase({ dataDirectory: path.join(root, 'history'), nowMs: 1 })
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function observation(seq: number, atMs: number, expiresAtMs: number): ActivityObservation {
  return {
    collectorSessionId: CollectorSessionId('collector-retention'),
    seq,
    observedAtMs: atMs,
    app: { pid: 100 + seq, bundleId: 'com.microsoft.VSCode' },
    surface: { kind: 'editor' },
    resource: { kind: 'file', canonicalUri: `file:///alpha/src/${seq}.ts`, displayLabel: `${seq}.ts` },
    workspace: { id: 'alpha', root: '/alpha', title: 'alpha', source: 'dsh', confidence: 1 },
    activity: {},
    privacy: { secure: false, protected: false },
    source: { provider: 'macos-ax', adapter: 'vscode' },
    policyRevision: 1,
    expiresAtMs,
  }
}

describe('retention service', () => {
  it('rebuilds derived episodes when raw observations expire', () => {
    const history = openTempDatabase()
    const resources = new ResourceStore(history.db)
    const observations = new ObservationStore(history.db)
    const episodes = new EpisodeStore(history.db)

    const first = observation(1, 1_000, 5_000)
    const second = observation(2, 2_000, 50_000)
    const firstResource = resources.upsert(first.resource!, first.observedAtMs)
    const secondResource = resources.upsert(second.resource!, second.observedAtMs)
    const firstId = observations.insert(first, firstResource)
    const secondId = observations.insert(second, secondResource)

    const originalId = EpisodeId('episode:collector-retention:1')
    episodes.replace({
      id: originalId, startedAtMs: 1_000, endedAtMs: 2_000,
      startReason: 'first-observation', endReason: 'timeout',
      workspace: { id: 'alpha', root: '/alpha', title: 'alpha' },
      threadKey: 'workspace:alpha', lastStrongResourceId: secondResource,
      summaryKind: 'deterministic', summary: 'Worked in alpha.',
      confidence: 1, state: 'closed', createdAtMs: 3_000, updatedAtMs: 3_000, expiresAtMs: 100_000,
      observationIds: [firstId, secondId],
      resources: [
        { resourceId: firstResource, firstSeenAtMs: 1_000, lastSeenAtMs: 1_000, observationCount: 1 },
        { resourceId: secondResource, firstSeenAtMs: 2_000, lastSeenAtMs: 2_000, observationCount: 1 },
      ],
      surfaces: [{
        bundleId: 'com.microsoft.VSCode', surfaceKind: 'editor',
        firstSeenAtMs: 1_000, lastSeenAtMs: 2_000, observationCount: 2,
      }],
    })

    const result = new RetentionService(history.db).sweep(10_000)
    expect(result.observations).toEqual({
      observationsDeleted: 1, episodesDeleted: 0, episodesRebuilt: 1,
    })
    expect(observations.count()).toBe(1)
    expect(episodes.get(originalId)).toBeUndefined()
    const rebuilt = episodes.listRecent()
    expect(rebuilt).toHaveLength(1)
    expect(rebuilt[0]?.id).toBe(EpisodeId('episode:collector-retention:2'))
    expect(rebuilt[0]?.resources.map((item) => item.canonicalUri)).toEqual([
      'file:///alpha/src/2.ts',
    ])
    history.close()
  })

  it('expires episodes without deleting still-live observations', () => {
    const history = openTempDatabase()
    const resources = new ResourceStore(history.db)
    const observations = new ObservationStore(history.db)
    const episodes = new EpisodeStore(history.db)

    const value = observation(1, 1_000, 50_000)
    const resourceId = resources.upsert(value.resource!, value.observedAtMs)
    const observationId = observations.insert(value, resourceId)
    const episodeId = EpisodeId('episode:collector-retention:1')

    episodes.replace({
      id: episodeId, startedAtMs: 1_000, endedAtMs: 1_000,
      startReason: 'first-observation', endReason: 'timeout',
      workspace: { id: 'alpha', root: '/alpha', title: 'alpha' },
      threadKey: 'workspace:alpha', lastStrongResourceId: resourceId,
      summaryKind: 'deterministic', summary: 'Worked in alpha.',
      confidence: 1, state: 'closed', createdAtMs: 2_000, updatedAtMs: 2_000, expiresAtMs: 5_000,
      observationIds: [observationId],
      resources: [{ resourceId, firstSeenAtMs: 1_000, lastSeenAtMs: 1_000, observationCount: 1 }],
      surfaces: [{
        bundleId: 'com.microsoft.VSCode', surfaceKind: 'editor',
        firstSeenAtMs: 1_000, lastSeenAtMs: 1_000, observationCount: 1,
      }],
    })

    const result = new RetentionService(history.db).sweep(10_000)
    expect(result.episodesDeleted).toBe(1)
    expect(episodes.get(episodeId)).toBeUndefined()
    expect(observations.count()).toBe(1)
    history.close()
  })
})
