import { describe, expect, it } from 'vitest'
import {
  EpisodeId,
  type EpisodeSummary,
  type ObservationId,
} from '../../src/shared/index.js'
import { buildWorkThreads } from '../../src/host/episodes/threads.js'

function episode(id: string, overrides: Partial<EpisodeSummary> = {}): EpisodeSummary {
  return {
    id: EpisodeId(id),
    startedAtMs: 1_000,
    endedAtMs: 2_000,
    boundary: { startReason: 'first-observation', endReason: 'timeout' },
    summaryKind: 'deterministic',
    summary: 'text',
    summaryObservationIds: [1] as ObservationId[],
    resources: [],
    surfaces: [],
    confidence: 0.5,
    state: 'closed',
    ...overrides,
  }
}

function fileResource(canonicalUri: string, displayLabel: string) {
  return {
    kind: 'file' as const,
    canonicalUri,
    displayLabel,
    firstSeenAtMs: 1,
    lastSeenAtMs: 2,
    observationCount: 1,
  }
}

describe('work threads', () => {
  it('groups episodes by threadKey and cites only their own evidence', () => {
    const threads = buildWorkThreads([
      episode('a', {
        threadKey: 'workspace:w1',
        startedAtMs: 10,
        endedAtMs: 20,
        workspace: { id: 'w1', title: 'repo', root: '/repo' },
        summaryObservationIds: [1, 2] as ObservationId[],
        resources: [fileResource('file:///repo/a.ts', 'a.ts')],
      }),
      episode('b', {
        threadKey: 'workspace:w1',
        startedAtMs: 30,
        endedAtMs: 40,
        workspace: { id: 'w1', title: 'repo', root: '/repo' },
        summaryObservationIds: [2, 3] as ObservationId[],
        resources: [
          fileResource('file:///repo/a.ts', 'a.ts'),
          fileResource('file:///repo/b.ts', 'b.ts'),
        ],
      }),
      episode('c', {
        threadKey: 'workspace:w2',
        summaryObservationIds: [9] as ObservationId[],
      }),
      // No thread key: not a thread, and it must not inherit anyone's citations.
      episode('d', { summaryObservationIds: [7] as ObservationId[] }),
    ])

    expect(threads.map(thread => thread.threadKey)).toEqual([
      'workspace:w2',
      'workspace:w1',
    ])
    const first = threads[1]!
    expect(first.episodeIds).toEqual(['a', 'b'])
    expect(first.summaryObservationIds).toEqual([1, 2, 3])
    expect(first.summaryObservationIds).not.toContain(7)
    expect(first.resources.map(resource => resource.canonicalUri))
      .toEqual(['file:///repo/a.ts', 'file:///repo/b.ts'])
    expect(first.summary).toContain('2 episodes in repo')
    expect(first.summary).toContain('a.ts, b.ts')
  })

  it('summarises a thread without resources honestly', () => {
    const threads = buildWorkThreads([
      episode('x', { threadKey: 'git:/repo' }),
    ])
    expect(threads[0]!.summary).toBe('1 episode in an unnamed workspace, touching no resources.')
  })
})
