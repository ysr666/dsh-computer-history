import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CollectorSessionId,
  EpisodeId,
  type ActivityObservation,
  type DeleteHistoryRequest,
} from '../../src/shared/index.js'
import { DeletionService, RetentionService } from '../../src/host/retention/index.js'
import { EpisodeStore, ObservationStore, openHistoryDatabase, ResourceStore } from '../../src/host/store/index.js'

const roots: string[] = []
function openTempDatabase() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-delete-'))
  roots.push(root)
  return openHistoryDatabase({ dataDirectory: path.join(root, 'history'), nowMs: 1 })
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function observation(input: {
  seq: number; atMs: number; bundleId: string; surface: 'editor' | 'browser' | 'terminal'
  uri: string; kind: 'file' | 'directory' | 'url'; workspace?: string
}): ActivityObservation {
  return {
    collectorSessionId: CollectorSessionId('collector-1'),
    seq: input.seq,
    observedAtMs: input.atMs,
    app: { pid: 100 + input.seq, bundleId: input.bundleId },
    surface: { kind: input.surface },
    resource: { kind: input.kind, canonicalUri: input.uri, displayLabel: input.uri.split('/').at(-1) || input.uri },
    workspace: input.workspace
      ? { id: input.workspace, root: `/${input.workspace}`, title: input.workspace, source: 'dsh', confidence: 1 }
      : { source: 'none', confidence: 0 },
    activity: {},
    privacy: { secure: false, protected: false },
    source: {
      provider: 'macos-ax',
      adapter: input.surface === 'editor' ? 'vscode' : input.surface === 'terminal' ? 'terminal' : 'generic',
    },
    policyRevision: 1,
    expiresAtMs: 100_000,
  }
}

function seedEpisode(history: ReturnType<typeof openTempDatabase>) {
  const resources = new ResourceStore(history.db)
  const observations = new ObservationStore(history.db)
  const episodes = new EpisodeStore(history.db)
  const values = [
    observation({ seq: 1, atMs: 1_000, bundleId: 'com.microsoft.VSCode', surface: 'editor', uri: 'file:///alpha/src/provider.ts', kind: 'file', workspace: 'alpha' }),
    observation({ seq: 2, atMs: 2_000, bundleId: 'com.google.Chrome', surface: 'browser', uri: 'https://docs.example/retry.html', kind: 'url' }),
    observation({ seq: 3, atMs: 3_000, bundleId: 'com.apple.Terminal', surface: 'terminal', uri: 'file:///alpha', kind: 'directory', workspace: 'alpha' }),
  ] as const
  const resourceIds = values.map((value) => resources.upsert(value.resource!, value.observedAtMs))
  const observationIds = values.map((value, index) => observations.insert(value, resourceIds[index]))
  const episodeId = EpisodeId('episode:collector-1:1')
  episodes.replace({
    id: episodeId, startedAtMs: 1_000, endedAtMs: 3_000,
    startReason: 'first-observation', endReason: 'timeout',
    workspace: { id: 'alpha', root: '/alpha', title: 'alpha' },
    threadKey: 'workspace:alpha', lastStrongResourceId: resourceIds[2]!,
    summaryKind: 'deterministic',
    summary: 'Worked in alpha with provider.ts, retry.html, and Terminal.',
    confidence: 1, state: 'closed', createdAtMs: 4_000, updatedAtMs: 4_000, expiresAtMs: 100_000,
    observationIds,
          })
  return { episodeId, observations, episodes }
}

describe('provenance-aware deletion', () => {
  it('removes app evidence and rebuilds all derived episode data', () => {
    const history = openTempDatabase()
    const seeded = seedEpisode(history)
    const deletion = new DeletionService(history.db)
    expect(deletion.delete({ scope: { kind: 'app', bundleId: 'com.google.Chrome' } }, 10_000)).toEqual({
      observationsDeleted: 1, episodesDeleted: 0, episodesRebuilt: 1,
    })
    const rebuilt = seeded.episodes.get(seeded.episodeId)
    expect(rebuilt?.observationIds).toHaveLength(2)
    expect(rebuilt?.resources.map((item) => item.canonicalUri)).toEqual([
      'file:///alpha/src/provider.ts', 'file:///alpha',
    ])
    expect(rebuilt?.surfaces.map((item) => item.bundleId)).toEqual([
      'com.microsoft.VSCode', 'com.apple.Terminal',
    ])
    expect(rebuilt?.summary).not.toContain('retry.html')
    expect(rebuilt?.summary).not.toContain('Chrome')
    const retainedDeadline = history.db.prepare(
      'SELECT expires_at_ms FROM episodes WHERE id = ?',
    ).get(seeded.episodeId) as {
      expires_at_ms: number
    }
    expect(
      Number(retainedDeadline.expires_at_ms),
    ).toBe(100_000)

    const chromeResources = history.db.prepare(
      "SELECT COUNT(*) AS count FROM resources WHERE canonical_uri = 'https://docs.example/retry.html'",
    ).get() as { count: number }
    expect(Number(chromeResources.count)).toBe(0)
    history.close()
  })

  it('deleting an episode removes its underlying observations', () => {
    const history = openTempDatabase()
    const seeded = seedEpisode(history)
    const deletion = new DeletionService(history.db)
    expect(deletion.delete({ scope: { kind: 'episode', episodeId: seeded.episodeId } }, 10_000)).toEqual({
      observationsDeleted: 3, episodesDeleted: 1, episodesRebuilt: 0,
    })
    expect(seeded.observations.count()).toBe(0)
    expect(seeded.episodes.get(seeded.episodeId)).toBeUndefined()
    history.close()
  })

  it('time-range deletion uses a half-open interval and rebuilds', () => {
    const history = openTempDatabase()
    const seeded = seedEpisode(history)
    const deletion = new DeletionService(history.db)
    const result = deletion.delete({
      scope: { kind: 'time-range', startMs: 2_000, endMs: 3_000 },
    }, 10_000)
    expect(result.observationsDeleted).toBe(1)
    expect(seeded.observations.count()).toBe(2)
    expect(seeded.episodes.get(seeded.episodeId)?.observationIds).toHaveLength(2)
    history.close()
  })

  it('forgets an app conservatively after raw provenance has expired', () => {
    const history = openTempDatabase()
    const seeded = seedEpisode(history)

    history.db.prepare(
      'UPDATE observations SET expires_at_ms = 5_000',
    ).run()
    expect(
      new RetentionService(history.db).sweep(10_000),
    ).toEqual({
      observationsDeleted: 3,
      episodesDeleted: 0,
    })
    expect(seeded.observations.count()).toBe(0)
    expect(
      seeded.episodes.get(seeded.episodeId),
    ).toBeDefined()

    const result = new DeletionService(history.db).delete({
      scope: {
        kind: 'app',
        bundleId: 'com.google.Chrome',
      },
    }, 20_000)

    expect(result).toEqual({
      observationsDeleted: 0,
      episodesDeleted: 1,
      episodesRebuilt: 0,
    })
    expect(
      seeded.episodes.get(seeded.episodeId),
    ).toBeUndefined()

    history.close()
  })

  it('deletes an overlapping derived episode for a time-range forget after raw expiry', () => {
    const history = openTempDatabase()
    const seeded = seedEpisode(history)

    history.db.prepare(
      'UPDATE observations SET expires_at_ms = 5_000',
    ).run()
    new RetentionService(history.db).sweep(10_000)

    const result = new DeletionService(history.db).delete({
      scope: {
        kind: 'time-range',
        startMs: 1_500,
        endMs: 2_500,
      },
    }, 20_000)

    expect(result).toEqual({
      observationsDeleted: 0,
      episodesDeleted: 1,
      episodesRebuilt: 0,
    })
    expect(
      seeded.episodes.get(seeded.episodeId),
    ).toBeUndefined()

    history.close()
  })

  it('deletes a requested derived episode after raw provenance has expired', () => {
    const history = openTempDatabase()
    const seeded = seedEpisode(history)

    history.db.prepare(
      'UPDATE observations SET expires_at_ms = 5_000',
    ).run()
    new RetentionService(history.db).sweep(10_000)

    expect(new DeletionService(history.db).delete({
      scope: {
        kind: 'episode',
        episodeId: seeded.episodeId,
      },
    }, 20_000)).toEqual({
      observationsDeleted: 0,
      episodesDeleted: 1,
      episodesRebuilt: 0,
    })
    expect(
      seeded.episodes.get(seeded.episodeId),
    ).toBeUndefined()
    history.close()
  })

  it('covers every delete scope across complete, partial, and expired provenance', () => {
    const provenanceStates = ['complete', 'partial', 'expired'] as const
    const scopes = ['app', 'time-range', 'episode', 'all'] as const

    for (const provenance of provenanceStates) {
      for (const scope of scopes) {
        const history = openTempDatabase()
        const seeded = seedEpisode(history)

        if (provenance === 'partial') {
          history.db.prepare(`
            UPDATE observations
            SET expires_at_ms = 5000
            WHERE observed_at_ms = 2000
          `).run()
          new RetentionService(history.db).sweep(10_000)
        } else if (provenance === 'expired') {
          history.db.prepare(
            'UPDATE observations SET expires_at_ms = 5000',
          ).run()
          new RetentionService(history.db).sweep(10_000)
        }

        let request: DeleteHistoryRequest
        switch (scope) {
          case 'app':
            request = {
              scope: {
                kind: 'app',
                bundleId: 'com.google.Chrome',
              },
            }
            break
          case 'time-range':
            request = {
              scope: {
                kind: 'time-range',
                startMs: 1_500,
                endMs: 2_500,
              },
            }
            break
          case 'episode':
            request = {
              scope: {
                kind: 'episode',
                episodeId: seeded.episodeId,
              },
            }
            break
          case 'all':
            request = { scope: { kind: 'all' } }
            break
        }

        const result = new DeletionService(history.db).delete(
          request,
          20_000,
        )
        const forceWholeEpisode =
          scope === 'episode'
          || scope === 'all'
          || provenance !== 'complete'

        if (forceWholeEpisode) {
          expect(
            result.episodesDeleted,
            `${scope}/${provenance}`,
          ).toBe(1)
          expect(result.episodesRebuilt).toBe(0)
          expect(
            seeded.episodes.get(seeded.episodeId),
            `${scope}/${provenance}`,
          ).toBeUndefined()
        } else {
          expect(result).toMatchObject({
            observationsDeleted: 1,
            episodesDeleted: 0,
            episodesRebuilt: 1,
          })
          expect(
            seeded.episodes.get(seeded.episodeId),
            `${scope}/${provenance}`,
          ).toBeDefined()
        }

        const expectedRaw = provenance === 'complete'
          ? (scope === 'episode' || scope === 'all' ? 0 : 2)
          : provenance === 'partial'
            ? (scope === 'episode' || scope === 'all' ? 0 : 2)
            : 0
        expect(
          seeded.observations.count(),
          `${scope}/${provenance}`,
        ).toBe(expectedRaw)
        history.close()
      }
    }
  })

  it('rolls back the whole operation when the request is invalid', () => {
    const history = openTempDatabase()
    const seeded = seedEpisode(history)
    const deletion = new DeletionService(history.db)
    expect(() => deletion.delete({
      scope: { kind: 'time-range', startMs: 5_000, endMs: 5_000 },
    }, 10_000)).toThrow(/endMs > startMs/)
    expect(seeded.observations.count()).toBe(3)
    expect(seeded.episodes.get(seeded.episodeId)?.observationIds).toHaveLength(3)
    history.close()
  })
})
