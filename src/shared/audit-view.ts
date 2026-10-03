import type {
  EpisodeBoundaryReason,
  EpisodeResourceSummary,
  EpisodeSurfaceSummary,
  EpisodeSummary,
  EpisodeWorkspaceSummary,
  WorkThread,
} from './episode.js'
import type { EpisodeId } from './ids.js'
import type { ResourceIdentity } from './resource.js'

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

export const TIMELINE_ACTIVITY_MERGE_GAP_MS = 10 * 60 * 1_000

/**
 * A reader-facing stretch of work built from one or more raw episodes.
 *
 * The raw episode ids stay attached so this projection never becomes a second
 * audit source of truth. `observedDurationMs` is the sum of time actually
 * present in the episodes. `spanDurationMs` is the elapsed first-to-last span
 * after applying the explicit merge rule and is therefore an approximation of
 * a human work session, not extra observed evidence.
 */
export interface TimelineActivity {
  readonly activityKey: string
  readonly representativeEpisodeId: EpisodeId
  readonly episodeIds: readonly EpisodeId[]
  readonly episodeCount: number
  readonly startedAtMs: number
  readonly endedAtMs: number
  readonly observedDurationMs: number
  readonly spanDurationMs: number
  readonly workspace?: EpisodeWorkspaceSummary
  readonly threadKey?: string
  readonly lastStrongResource?: ResourceIdentity
  readonly resources: readonly EpisodeResourceSummary[]
  readonly surfaces: readonly EpisodeSurfaceSummary[]
}

export interface WorkThreadDetail {
  readonly thread: WorkThread
  readonly timeline: readonly TimelineDay[]
}

export interface TimelineDay {
  readonly dayKey: string
  /** Raw audit episodes retained unchanged. */
  readonly episodeCount: number
  readonly episodes: readonly EpisodeSummary[]
  /** Reader-facing activities deterministically projected from `episodes`. */
  readonly activityCount: number
  readonly activities: readonly TimelineActivity[]
  readonly startedAtMs: number
  readonly endedAtMs: number
}

function activitySignature(episode: EpisodeSummary): string | undefined {
  const app = episode.surfaces[0]?.bundleId
  if (!app) return undefined
  if (episode.threadKey) return `${app}|thread:${episode.threadKey}`
  if (episode.workspace?.id) return `${app}|workspace-id:${episode.workspace.id}`
  if (episode.workspace?.root) return `${app}|workspace-root:${episode.workspace.root}`
  const resource = episode.lastStrongResource ?? episode.resources[0]
  return resource ? `${app}|resource:${resource.kind}:${resource.canonicalUri}` : undefined
}

function mergeResources(episodes: readonly EpisodeSummary[]): readonly EpisodeResourceSummary[] {
  const merged = new Map<string, EpisodeResourceSummary>()
  for (const episode of episodes) {
    for (const resource of episode.resources) {
      const key = `${resource.kind}\u0000${resource.canonicalUri}`
      const previous = merged.get(key)
      if (!previous) {
        merged.set(key, resource)
        continue
      }
      const displayLabel = resource.displayLabel ?? previous.displayLabel
      merged.set(key, {
        kind: previous.kind,
        canonicalUri: previous.canonicalUri,
        ...(displayLabel === undefined ? {} : { displayLabel }),
        firstSeenAtMs: Math.min(previous.firstSeenAtMs, resource.firstSeenAtMs),
        lastSeenAtMs: Math.max(previous.lastSeenAtMs, resource.lastSeenAtMs),
        observationCount: previous.observationCount + resource.observationCount,
      })
    }
  }
  return [...merged.values()].toSorted((a, b) => b.lastSeenAtMs - a.lastSeenAtMs)
}

function mergeSurfaces(episodes: readonly EpisodeSummary[]): readonly EpisodeSurfaceSummary[] {
  const merged = new Map<string, EpisodeSurfaceSummary>()
  for (const episode of episodes) {
    for (const surface of episode.surfaces) {
      const key = `${surface.bundleId}\u0000${surface.surfaceKind}`
      const previous = merged.get(key)
      merged.set(key, previous
        ? {
            ...previous,
            firstSeenAtMs: Math.min(previous.firstSeenAtMs, surface.firstSeenAtMs),
            lastSeenAtMs: Math.max(previous.lastSeenAtMs, surface.lastSeenAtMs),
            observationCount: previous.observationCount + surface.observationCount,
          }
        : surface)
    }
  }
  return [...merged.values()].toSorted((a, b) => b.lastSeenAtMs - a.lastSeenAtMs)
}

function activityFromEpisodes(episodes: readonly EpisodeSummary[]): TimelineActivity {
  const ordered = episodes.toSorted((a, b) => a.startedAtMs - b.startedAtMs)
  const newest = ordered.at(-1)!
  const startedAtMs = Math.min(...ordered.map(episode => episode.startedAtMs))
  const endedAtMs = Math.max(...ordered.map(episode => episode.endedAtMs))
  return {
    activityKey: `activity:${ordered.map(episode => String(episode.id)).join(',')}`,
    representativeEpisodeId: newest.id,
    episodeIds: ordered.map(episode => episode.id),
    episodeCount: ordered.length,
    startedAtMs,
    endedAtMs,
    observedDurationMs: ordered.reduce(
      (total, episode) => total + Math.max(0, episode.endedAtMs - episode.startedAtMs),
      0,
    ),
    spanDurationMs: Math.max(0, endedAtMs - startedAtMs),
    ...(newest.workspace === undefined ? {} : { workspace: newest.workspace }),
    ...(newest.threadKey === undefined ? {} : { threadKey: newest.threadKey }),
    ...(newest.lastStrongResource === undefined ? {} : { lastStrongResource: newest.lastStrongResource }),
    resources: mergeResources(ordered),
    surfaces: mergeSurfaces(ordered),
  }
}

/**
 * Merge raw episodes into human-scale activities without changing the audit
 * records. Only episodes from the same app and explicit work identity can
 * merge, only within a local day, and only across a short bounded gap.
 */
export function buildTimelineActivities(
  episodes: readonly EpisodeSummary[],
  options: { readonly mergeGapMs?: number } = {},
): readonly TimelineActivity[] {
  const mergeGapMs = Math.max(0, options.mergeGapMs ?? TIMELINE_ACTIVITY_MERGE_GAP_MS)
  const ordered = episodes.toSorted((a, b) => a.startedAtMs - b.startedAtMs)
  const groups: EpisodeSummary[][] = []
  let current: EpisodeSummary[] = []
  let signature: string | undefined

  const flush = (): void => {
    if (current.length > 0) groups.push(current)
    current = []
    signature = undefined
  }

  for (const episode of ordered) {
    const nextSignature = activitySignature(episode)
    const previous = current.at(-1)
    const sameDay = previous
      ? localDayKey(previous.startedAtMs) === localDayKey(episode.startedAtMs)
      : true
    const gapMs = previous ? Math.max(0, episode.startedAtMs - previous.endedAtMs) : 0
    const canMerge = previous !== undefined
      && nextSignature !== undefined
      && signature === nextSignature
      && sameDay
      && gapMs <= mergeGapMs

    if (!canMerge) flush()
    current.push(episode)
    signature = nextSignature
  }
  flush()

  return groups
    .map(activityFromEpisodes)
    .toSorted((a, b) => b.startedAtMs - a.startedAtMs)
}

/**
 * Group episodes into the days they happened on, newest first. The grouping is
 * the only thing this adds: the episodes themselves are stored, and a timeline
 * that recomputed their content would be a second source of truth.
 */
export function buildTimeline(
  episodes: readonly EpisodeSummary[],
  options: { readonly days?: number; readonly activityMergeGapMs?: number } = {},
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
    const activities = buildTimelineActivities(
      ordered,
      options.activityMergeGapMs === undefined
        ? {}
        : { mergeGapMs: options.activityMergeGapMs },
    )
    days.push({
      dayKey,
      episodeCount: ordered.length,
      episodes: ordered,
      activityCount: activities.length,
      activities,
      startedAtMs: Math.min(...ordered.map(episode => episode.startedAtMs)),
      endedAtMs: Math.max(...ordered.map(episode => episode.endedAtMs)),
    })
  }

  return days
    .toSorted((a, b) => (a.dayKey < b.dayKey ? 1 : -1))
    .slice(0, options.days ?? days.length)
}
