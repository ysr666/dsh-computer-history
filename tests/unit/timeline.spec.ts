import { describe, expect, it } from 'vitest'
import {
  EpisodeId,
  type EpisodeSummary,
  buildTimeline,
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
