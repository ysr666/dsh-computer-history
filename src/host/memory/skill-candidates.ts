import { createHash } from 'node:crypto'
import type {
  EpisodeSummary, SkillCandidate, SkillCandidateKind, SkillCandidateReport,
} from '../../shared/index.js'
import { memoryIdForThreadKey } from './projector.js'

const MIN_EPISODES = 3
const MIN_DAYS = 2
const MAX_SOURCES = 12
const MAX_RESULTS = 3
const MAX_SCANNED = 1_000
const DAY_MS = 86_400_000

type RepeatGroup = {
  kind: SkillCandidateKind
  subject: string
  episodes: EpisodeSummary[]
  observedKinds: string[]
}

function dayCount(items: readonly EpisodeSummary[]): number {
  return new Set(items.map(e => Math.floor(e.endedAtMs / DAY_MS))).size
}

function candidate(
  group: RepeatGroup, projectMemoryId: string,
): SkillCandidate | undefined {
  // Every source Episode counts once. observationCount is NOT repeat frequency.
  const unique = [...new Map(group.episodes.map(e => [String(e.id), e])).values()]
    .toSorted((a, b) => b.endedAtMs - a.endedAtMs
      || String(a.id).localeCompare(String(b.id)))
  const distinctDayCount = dayCount(unique)
  if (unique.length < MIN_EPISODES || distinctDayCount < MIN_DAYS) return
  const details: Record<SkillCandidateKind, {
    title: string; observation: string; missingEvidence: string[]
  }> = {
    'repeated-verification': {
      title: 'Repeated ' + group.subject + ' checks',
      observation: 'Verification results were recorded in separate work Episodes. No command or ordered procedure was captured.',
      missingEvidence: [
        'Exact test/build command and target',
        'Expected result and handling of failures',
        'Preconditions, dependencies and safe execution permissions',
      ],
    },
    'save-and-verification': {
      title: 'Repeated file-change and ' + group.subject + ' co-occurrence',
      observation: 'A saved-file event and a verification event appear within each cited Episode. Their order and causal connection were not established.',
      missingEvidence: [
        'Whether editing preceded verification',
        'Exact files, test/build commands and required environment',
        'Acceptance criteria, rollback and error-handling steps',
      ],
    },
    'repeated-file-changes': {
      title: 'Repeated edits to the same file',
      observation: 'The same canonical local file URI was changed in multiple separate Episodes. The actual edit operations are unknown.',
      missingEvidence: [
        'Actual editing steps and whether changes were similar',
        'User intent, expected output and safe execution permissions',
        'Any verification or review procedure',
      ],
    },
  }
  const detail = details[group.kind]
  return {
    id: 'sc_' + createHash('sha256').update(
      projectMemoryId + '\u0000' + group.kind + '\u0000' + group.subject,
    ).digest('hex'),
    kind: group.kind, title: detail.title,
    observation: detail.observation,
    episodeCount: unique.length,
    distinctDayCount,
    firstObservedAtMs: Math.min(...unique.map(e => e.startedAtMs)),
    lastObservedAtMs: Math.max(...unique.map(e => e.endedAtMs)),
    evidenceEpisodeIds: unique.slice(0, MAX_SOURCES).map(e => String(e.id)),
    evidenceTruncated: unique.length > MAX_SOURCES,
    observedKinds: group.observedKinds,
    missingEvidence: detail.missingEvidence,
    readiness: 'needs-user-design',
  }
}

export function discoverSkillCandidates(
  episodes: readonly EpisodeSummary[],
  projectMemoryId: string,
  nowMs: number,
  inputTruncated = false,
): SkillCandidateReport {
  if (!/^pm_[a-f0-9]{64}$/.test(projectMemoryId)) {
    throw new Error('invalid project memory id')
  }
  const selected = episodes
    .filter(e => e.state !== 'invalidated'
      && e.threadKey && memoryIdForThreadKey(e.threadKey) === projectMemoryId
      && e.startedAtMs <= nowMs)
    .slice(0, MAX_SCANNED)
  const groups = new Map<string, RepeatGroup>()
  const add = (kind: SkillCandidateKind, subject: string,
    episode: EpisodeSummary, observedKinds: readonly string[]): void => {
    const key = kind + '\u0000' + subject
    const existing = groups.get(key)
    if (existing) {
      existing.episodes.push(episode)
    } else {
      groups.set(key, {
        kind, subject, episodes: [episode], observedKinds: [...observedKinds],
      })
    }
  }
  for (const e of selected) {
    const checks = new Set((e.verifications ?? []).map(v => v.kind)
      .filter(kind => kind === 'test' || kind === 'build'))
    const saved = new Set((e.changedResources ?? [])
      .filter(resource => resource.kind === 'file')
      .map(resource => resource.canonicalUri)
      .filter(uri => uri.startsWith('file:///') || uri.startsWith('/')))
    for (const check of checks) {
      add('repeated-verification', check, e, [check])
      if (saved.size > 0) {
        add('save-and-verification', check, e, ['save', check])
      }
    }
    for (const uri of saved) {
      // Canonical file identity and opaque candidate ID; full paths are not
      // returned as executable instructions or included in the title.
      add('repeated-file-changes', uri, e, ['save'])
    }
  }
  const candidates = [...groups.values()]
    .map(group => candidate(group, projectMemoryId))
    .filter((value): value is SkillCandidate => value !== undefined)
    .toSorted((a, b) => b.distinctDayCount - a.distinctDayCount
      || b.episodeCount - a.episodeCount
      || b.lastObservedAtMs - a.lastObservedAtMs
      || a.id.localeCompare(b.id))
    .slice(0, MAX_RESULTS)
  return {
    projectMemoryId,
    candidates,
    scannedEpisodes: selected.length,
    scanTruncated: inputTruncated || episodes.length >= MAX_SCANNED,
    conclusion: candidates.length ? 'candidates-found' : 'insufficient-evidence',
    privacy: {
      userConfirmedNotes: 'not-read', fileBodies: 'not-read',
      autoCreateOrInstall: false,
    },
    caveat: 'Advisory candidate patterns only. At least three different retained Episodes across two UTC days. The event metadata does not establish a safe ordered workflow or executable commands. No Skill is created or installed.',
  }
}
