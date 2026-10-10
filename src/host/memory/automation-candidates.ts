import { createHash } from 'node:crypto'
import type {
  AutomationCandidate, AutomationCandidateReport,
  EpisodeSummary,
} from '../../shared/index.js'
import { memoryIdForThreadKey } from './projector.js'

const DAY_MS = 86_400_000
const SCAN_CAP = 1_000
const MAX_SOURCES = 12
const MAX_CANDIDATES = 2

interface DayEvidence {
  readonly dayNumber: number
  readonly episode: EpisodeSummary
}

function utcDay(ms: number): number {
  return Math.floor(ms / DAY_MS)
}

function calendarDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

/** Strict consecutive *calendar day* recurrence, not an inferred clock time. */
function consecutive(
  days: readonly DayEvidence[],
  kind: 'daily-pattern' | 'weekly-pattern',
): readonly DayEvidence[] {
  const need = kind === 'daily-pattern' ? 4 : 3
  const selected = days.slice(0, need)
  if (selected.length < need) return []
  const minimumGap = kind === 'daily-pattern' ? 1 : 6
  const maximumGap = kind === 'daily-pattern' ? 1 : 8
  for (let i = 1; i < selected.length; i += 1) {
    const gap = selected[i - 1]!.dayNumber - selected[i]!.dayNumber
    if (gap < minimumGap || gap > maximumGap) return []
  }
  return selected
}

function build(
  projectMemoryId: string,
  activity: 'test' | 'build',
  cadence: 'daily-pattern' | 'weekly-pattern',
  source: readonly DayEvidence[],
): AutomationCandidate {
  const ids = source.map(s => String(s.episode.id))
  return {
    id: 'ac_' + createHash('sha256').update(
      projectMemoryId + '\u0000verification-review\u0000'
      + activity + '\u0000' + cadence,
    ).digest('hex'),
    kind: 'verification-review',
    observedActivity: activity,
    cadence,
    observedOnDaysUtc: source.map(s => calendarDate(s.dayNumber)),
    lastObservedAtMs: Math.max(...source.map(s => s.episode.endedAtMs)),
    distinctDayCount: source.length,
    sourceEpisodeIds: ids.slice(0, MAX_SOURCES),
    evidenceTruncated: ids.length > MAX_SOURCES,
    observation: 'Repeated ' + activity
      + ' results occurred on roughly ' + (cadence === 'daily-pattern' ? 'daily' : 'weekly')
      + ' calendar dates; this does not prove that the task itself needs to recur.',
    missingDecisions: [
      'Whether the work should recur at all',
      'Reminder goal, title and the exact local schedule/time zone',
      'Notification destination, duration and cancellation conditions',
      'Separate authorization for any file access, external service or command execution',
    ],
    readiness: 'requires-user-review',
    permittedAction: 'review-reminder-only',
  }
}

/** In-memory evidence projection, not a scheduler, not a job creator. */
export function discoverAutomationCandidates(
  episodes: readonly EpisodeSummary[],
  projectMemoryId: string,
  nowMs: number,
  inputTruncated = false,
): AutomationCandidateReport {
  if (!/^pm_[a-f0-9]{64}$/.test(projectMemoryId)) {
    throw new Error('invalid project memory id')
  }
  const selected = episodes
    .filter(e => e.state !== 'invalidated'
      && !!e.threadKey && memoryIdForThreadKey(e.threadKey) === projectMemoryId
      && e.startedAtMs <= nowMs && e.endedAtMs <= nowMs)
    .slice(0, SCAN_CAP)

  const candidates: AutomationCandidate[] = []
  for (const activity of ['test', 'build'] as const) {
    const perDay = new Map<number, EpisodeSummary>()
    for (const episode of selected) {
      if (!(episode.verifications ?? []).some(v => v.kind === activity
        && v.lastObservedAtMs <= nowMs)) continue
      const day = utcDay(episode.endedAtMs)
      const existing = perDay.get(day)
      if (!existing || episode.endedAtMs > existing.endedAtMs
        || (episode.endedAtMs === existing.endedAtMs
          && String(episode.id).localeCompare(String(existing.id)) < 0)) {
        perDay.set(day, episode)
      }
    }
    const days = [...perDay.entries()]
      .map(([dayNumber, episode]) => ({ dayNumber, episode }))
      .toSorted((a, b) => b.dayNumber - a.dayNumber)
    const mostRecent = days[0]?.dayNumber
    if (mostRecent === undefined) continue
    const age = utcDay(nowMs) - mostRecent
    // Stale habits must not trigger fresh automated reminders.
    for (const cadence of ['daily-pattern', 'weekly-pattern'] as const) {
      if (age > (cadence === 'daily-pattern' ? 10 : 16)) continue
      const run = consecutive(days, cadence)
      if (!run.length) continue
      candidates.push(build(projectMemoryId, activity, cadence, run))
    }
  }

  const ranked = candidates.toSorted((a, b) =>
    b.lastObservedAtMs - a.lastObservedAtMs
    || b.distinctDayCount - a.distinctDayCount
    || a.id.localeCompare(b.id)).slice(0, MAX_CANDIDATES)
  return {
    projectMemoryId,
    candidates: ranked,
    scannedEpisodes: selected.length,
    scanTruncated: inputTruncated || episodes.length >= SCAN_CAP
      || candidates.length > MAX_CANDIDATES,
    conclusion: ranked.length ? 'candidate-found' : 'no-reliable-cadence',
    privacy: {
      confirmedNotes: 'not-read',
      fileBodies: 'not-read',
      backgroundMonitoring: false,
      jobsCreated: false,
      executableCommands: 'not-collected-or-run',
    },
    caveat: 'UTC calendar-date intervals are historical hints, not a verified recurring schedule or permission. No exact time is inferred. Suggestions are limited to user-reviewed reminder drafts; no task is created, enabled, or run.',
  }
}
