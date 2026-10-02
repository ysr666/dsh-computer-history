import type {
  EpisodeBoundaryReason,
  EpisodeSummary,
} from './episode.js'

/**
 * Why an episode exists and why it stopped, in a sentence a person can read.
 *
 * This is the answer to "why was this recorded": the boundary reasons are the
 * Host's own vocabulary, and a reader should not have to learn it to audit what
 * is stored.
 */
const START_REASONS: Record<EpisodeBoundaryReason, string> = {
  'first-observation': 'a supported application became active',
  'workspace-switch': 'the work moved to another workspace',
  'idle': 'activity resumed after a pause',
  'sleep': 'the machine woke up',
  'pause': 'capture was resumed',
  'collector-restart': 'the collector restarted',
  'timeout': 'a new stretch of work began',
  'manual-rebuild': 'the history was rebuilt after a deletion',
}

const END_REASONS: Record<EpisodeBoundaryReason, string> = {
  'first-observation': 'another episode started',
  'workspace-switch': 'the work moved to another workspace',
  'idle': 'the machine went idle',
  'sleep': 'the machine slept',
  'pause': 'capture was paused',
  'collector-restart': 'the collector restarted',
  'timeout': 'a quiet period passed',
  'manual-rebuild': 'the history was rebuilt after a deletion',
}

export interface ProvenanceInput {
  readonly boundary: {
    readonly startReason: EpisodeBoundaryReason
    readonly endReason?: EpisodeBoundaryReason
  }
  readonly policyRevision: number
  readonly citations: readonly unknown[]
  readonly resources: readonly unknown[]
  readonly surfaces: readonly { readonly bundleId: string }[]
  readonly confidence: number
}

export function describeProvenance(input: ProvenanceInput): string {
  const started = START_REASONS[input.boundary.startReason]
    ?? String(input.boundary.startReason)
  const ended = input.boundary.endReason
    ? END_REASONS[input.boundary.endReason] ?? String(input.boundary.endReason)
    : undefined

  const parts = [
    `Recorded because ${started}`,
    ended ? `and it ended because ${ended}` : 'and it has not ended yet',
  ]
  parts.push(
    `${input.citations.length} observation${input.citations.length === 1 ? '' : 's'} cited`,
  )
  parts.push(
    `${input.resources.length} resource${input.resources.length === 1 ? '' : 's'}`,
    `${input.surfaces.length} application${input.surfaces.length === 1 ? '' : 's'}`,
  )
  parts.push(`policy revision ${input.policyRevision}`)
  parts.push(`confidence ${input.confidence.toFixed(2)}`)
  return `${parts.join('; ')}.`
}

/** The day an episode belongs to, in local time, as `YYYY-MM-DD`. */
export function localDayKey(atMs: number): string {
  const date = new Date(atMs)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export interface TimelineDay {
  readonly dayKey: string
  readonly episodeCount: number
  readonly startedAtMs: number
  readonly endedAtMs: number
  readonly episodes: readonly EpisodeSummary[]
}

/**
 * Group episodes into the days they happened on, newest first. The grouping is
 * the only thing this adds: the episodes themselves are stored, and a timeline
 * that recomputed their content would be a second source of truth.
 */
export function buildTimeline(
  episodes: readonly EpisodeSummary[],
  options: { readonly days?: number } = {},
): readonly TimelineDay[] {
  const byDay = new Map<string, EpisodeSummary[]>()
  for (const episode of episodes) {
    const key = localDayKey(episode.startedAtMs)
    const bucket = byDay.get(key)
    if (bucket) bucket.push(episode)
    else byDay.set(key, [episode])
  }

  const days: TimelineDay[] = []
  for (const [dayKey, members] of byDay) {
    const ordered = members.toSorted((a, b) => b.startedAtMs - a.startedAtMs)
    days.push({
      dayKey,
      episodeCount: ordered.length,
      startedAtMs: Math.min(...ordered.map(episode => episode.startedAtMs)),
      endedAtMs: Math.max(...ordered.map(episode => episode.endedAtMs)),
      episodes: ordered,
    })
  }

  return days
    .toSorted((a, b) => (a.dayKey < b.dayKey ? 1 : -1))
    .slice(0, options.days ?? days.length)
}
