import { describe, expect, it } from 'vitest'
import {
  EpisodeId,
  type EpisodeSummary,
  buildTimeline,
  buildTimelineActivities,
  describeProvenance,
  localDayKey,
} from '../../src/shared/index.js'

function episode(id: string, startedAtMs: number, endedAtMs: number): EpisodeSummary {
  return {
    id: EpisodeId(id),
    startedAtMs,
    endedAtMs,
    boundary: { startReason: 'first-observation', endReason: 'timeout' },
    summaryKind: 'deterministic',
    summary: 'text',
    summaryObservationIds: [1 as never],
    resources: [],
    surfaces: [],
    confidence: 0.5,
    state: 'closed',
  }
}


function workEpisode(input: {
  readonly id: string
  readonly startedAtMs: number
  readonly endedAtMs: number
  readonly app: string
  readonly workspaceRoot?: string
  readonly workspaceTitle?: string
  readonly threadKey?: string
  readonly resourceUri?: string
  readonly resourceLabel?: string
}): EpisodeSummary {
  const base = episode(input.id, input.startedAtMs, input.endedAtMs)
  const resource = input.resourceUri
    ? {
        kind: 'file' as const,
        canonicalUri: input.resourceUri,
        ...(input.resourceLabel === undefined ? {} : { displayLabel: input.resourceLabel }),
        firstSeenAtMs: input.startedAtMs,
        lastSeenAtMs: input.endedAtMs,
        observationCount: 1,
      }
    : undefined
  return {
    ...base,
    ...(input.workspaceRoot === undefined && input.workspaceTitle === undefined
      ? {}
      : {
          workspace: {
            ...(input.workspaceRoot === undefined ? {} : { root: input.workspaceRoot }),
            ...(input.workspaceTitle === undefined ? {} : { title: input.workspaceTitle }),
          },
        }),
    ...(input.threadKey === undefined ? {} : { threadKey: input.threadKey }),
    ...(resource === undefined
      ? {}
      : {
          lastStrongResource: {
            kind: resource.kind,
            canonicalUri: resource.canonicalUri,
            ...(resource.displayLabel === undefined ? {} : { displayLabel: resource.displayLabel }),
          },
        }),
    resources: resource ? [resource] : [],
    surfaces: [{
      bundleId: input.app,
      surfaceKind: input.app.includes('Terminal') ? 'terminal' : 'editor',
      firstSeenAtMs: input.startedAtMs,
      lastSeenAtMs: input.endedAtMs,
      observationCount: 1,
    }],
  }
}

describe('timeline', () => {
  it('groups episodes into local days, newest day first', () => {
    const early = new Date('2026-10-01T09:00:00').getTime()
    const late = new Date('2026-10-02T21:00:00').getTime()
    const night = new Date('2026-10-02T23:30:00').getTime()

    const days = buildTimeline([
      episode('a', early, early + 60_000),
      episode('b', late, late + 60_000),
      episode('c', night, night + 60_000),
    ])

    expect(days.map(day => day.dayKey)).toEqual([
      localDayKey(night),
      localDayKey(early),
    ])
    expect(days[0]!.episodeCount).toBe(2)
    // Newest episode first inside the day.
    expect(days[0]!.episodes.map(item => String(item.id))).toEqual(['c', 'b'])
    expect(days[1]!.episodeCount).toBe(1)
  })

  it('honours the day limit', () => {
    const days = buildTimeline([
      episode('a', new Date('2026-10-01T09:00:00').getTime(), 1),
      episode('b', new Date('2026-10-02T09:00:00').getTime(), 2),
    ], { days: 1 })
    expect(days).toHaveLength(1)
  })


  it('projects nearby episodes in the same app and workspace into one activity', () => {
    const base = new Date('2026-10-03T15:17:00').getTime()
    const episodes = [
      workEpisode({
        id: 'a', startedAtMs: base, endedAtMs: base + 1_000,
        app: 'com.microsoft.VSCode', workspaceRoot: '/repo', workspaceTitle: 'repo',
        resourceUri: 'file:///repo/ui-review.md', resourceLabel: 'ui-review.md',
      }),
      workEpisode({
        id: 'b', startedAtMs: base + 7 * 60_000, endedAtMs: base + 7 * 60_000 + 2_000,
        app: 'com.microsoft.VSCode', workspaceRoot: '/repo', workspaceTitle: 'repo',
        resourceUri: 'file:///repo/validation.md', resourceLabel: 'validation.md',
      }),
      workEpisode({
        id: 'c', startedAtMs: base + 9 * 60_000, endedAtMs: base + 9 * 60_000 + 3_000,
        app: 'com.microsoft.VSCode', workspaceRoot: '/repo', workspaceTitle: 'repo',
        resourceUri: 'file:///repo/validation.md', resourceLabel: 'validation.md',
      }),
    ]

    const activities = buildTimelineActivities(episodes)
    expect(activities).toHaveLength(1)
    expect(activities[0]!.episodeIds.map(String)).toEqual(['a', 'b', 'c'])
    expect(activities[0]!.episodeCount).toBe(3)
    expect(activities[0]!.observedDurationMs).toBe(6_000)
    expect(activities[0]!.spanDurationMs).toBe(9 * 60_000 + 3_000)
    expect(activities[0]!.representativeEpisodeId).toBe(episodes[2]!.id)
    expect(activities[0]!.resources.map(item => item.displayLabel)).toEqual([
      'validation.md', 'ui-review.md',
    ])
  })

  it('does not merge different apps, workspaces, or long gaps', () => {
    const base = new Date('2026-10-03T12:00:00').getTime()
    const activities = buildTimelineActivities([
      workEpisode({
        id: 'a', startedAtMs: base, endedAtMs: base + 60_000,
        app: 'com.microsoft.VSCode', workspaceRoot: '/repo-a',
      }),
      workEpisode({
        id: 'b', startedAtMs: base + 2 * 60_000, endedAtMs: base + 3 * 60_000,
        app: 'com.apple.Terminal', workspaceRoot: '/repo-a',
      }),
      workEpisode({
        id: 'c', startedAtMs: base + 4 * 60_000, endedAtMs: base + 5 * 60_000,
        app: 'com.microsoft.VSCode', workspaceRoot: '/repo-b',
      }),
      workEpisode({
        id: 'd', startedAtMs: base + 20 * 60_000, endedAtMs: base + 21 * 60_000,
        app: 'com.microsoft.VSCode', workspaceRoot: '/repo-b',
      }),
    ])

    expect(activities).toHaveLength(4)
    expect(activities.every(activity => activity.episodeCount === 1)).toBe(true)
  })

  it('falls back to an exact resource identity when no workspace is known', () => {
    const base = new Date('2026-10-03T10:00:00').getTime()
    const activities = buildTimelineActivities([
      workEpisode({
        id: 'a', startedAtMs: base, endedAtMs: base + 30_000,
        app: 'com.apple.Preview', resourceUri: 'file:///tmp/report.pdf', resourceLabel: 'report.pdf',
      }),
      workEpisode({
        id: 'b', startedAtMs: base + 2 * 60_000, endedAtMs: base + 3 * 60_000,
        app: 'com.apple.Preview', resourceUri: 'file:///tmp/report.pdf', resourceLabel: 'report.pdf',
      }),
    ])
    expect(activities).toHaveLength(1)
    expect(activities[0]!.episodeCount).toBe(2)
  })

  it('keeps raw episode counts while exposing the smaller activity count', () => {
    const base = new Date('2026-10-03T15:00:00').getTime()
    const days = buildTimeline([
      workEpisode({
        id: 'a', startedAtMs: base, endedAtMs: base + 1_000,
        app: 'com.microsoft.VSCode', workspaceRoot: '/repo',
      }),
      workEpisode({
        id: 'b', startedAtMs: base + 2 * 60_000, endedAtMs: base + 2 * 60_000 + 1_000,
        app: 'com.microsoft.VSCode', workspaceRoot: '/repo',
      }),
      workEpisode({
        id: 'c', startedAtMs: base + 30 * 60_000, endedAtMs: base + 30 * 60_000 + 1_000,
        app: 'com.apple.Terminal', workspaceRoot: '/Users/test',
      }),
    ])

    expect(days[0]!.episodeCount).toBe(3)
    expect(days[0]!.activityCount).toBe(2)
    expect(days[0]!.episodes).toHaveLength(3)
    expect(days[0]!.activities).toHaveLength(2)
  })
})

describe('why was this recorded', () => {
  it('reads as a sentence, not as the Host vocabulary', () => {
    const sentence = describeProvenance({
      boundary: { startReason: 'first-observation', endReason: 'idle' },
      policyRevision: 4,
      citations: [1, 2],
      resources: [{}],
      surfaces: [{ bundleId: 'com.microsoft.VSCode' }],
      confidence: 0.8,
    })
    expect(sentence).toBe(
      'Recorded because a supported application became active; and it ended '
      + 'because the machine went idle; 2 observations cited; 1 resource; '
      + '1 application; policy revision 4; confidence 0.80.',
    )
  })

  it('says so when the episode has not ended, and counts singulars', () => {
    const sentence = describeProvenance({
      boundary: { startReason: 'pause' },
      policyRevision: 1,
      citations: [7],
      resources: [],
      surfaces: [],
      confidence: 1,
    })
    expect(sentence).toContain('capture was resumed')
    expect(sentence).toContain('it has not ended yet')
    expect(sentence).toContain('1 observation cited')
    expect(sentence).toContain('0 resources')
    expect(sentence).toContain('confidence 1.00')
  })

  it('covers every boundary reason with words', () => {
    const reasons = [
      'first-observation', 'workspace-switch', 'idle', 'sleep', 'pause',
      'collector-restart', 'timeout', 'manual-rebuild',
    ] as const
    // A single word such as "idle" can legitimately appear inside a human
    // phrase ("the machine went idle"); the hyphenated tokens cannot, so those
    // are the ones that prove the vocabulary was translated.
    const machineTokens = [
      'first-observation', 'workspace-switch', 'collector-restart',
      'manual-rebuild',
    ]
    for (const reason of reasons) {
      const sentence = describeProvenance({
        boundary: { startReason: reason, endReason: reason },
        policyRevision: 1,
        citations: [],
        resources: [],
        surfaces: [],
        confidence: 0,
      })
      for (const token of machineTokens) {
        expect(sentence, `${reason}: ${sentence}`).not.toContain(token)
      }
      expect(sentence.length).toBeGreaterThan(20)
    }
  })
})
