import { createHash } from 'node:crypto'
import type {
  AskHistoryRequest,
  AskHistoryResult,
  EpisodeSummary,
  HistoryQuestionIntent,
  HistorySearchHit,
} from '../../shared/index.js'
import { episodeEvidenceLevel } from './evidence.js'
import { memoryIdForThreadKey } from './projector.js'

const MAX_SCANNED = 1000
const DAY_MS = 86_400_000

function dateMidnight(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
}

export function interpretHistoryQuestion(
  rawQuery: string, nowMs: number,
): {
  readonly intent: HistoryQuestionIntent
  readonly from?: number
  readonly until?: number
  readonly terms: readonly string[]
} {
  const query = rawQuery.trim()
  const lower = query.toLocaleLowerCase()
  const files = /文件|文档|资料|file|document|code|代码|网页|页面|资源/i
  const saves = /保存|修改|更改|变更|改了|改过|save|changed|modified|edit(ed)?/i
  const checks = /测试|构建|验证|通过|失败|test|build|verify|check/i
  const apps = /应用|软件|程序|app|application|software/i
  const projects = /项目|工程|仓库|工作区|project|workspace|repositor/i
  const intent: HistoryQuestionIntent = checks.test(query) ? 'checks'
    : saves.test(query) ? 'saves'
    : files.test(query) ? 'files'
    : apps.test(query) ? 'applications'
    : projects.test(query) ? 'projects' : 'overview'

  const today = dateMidnight(new Date(nowMs))
  const weekday = (new Date(today).getDay() + 6) % 7
  const thisMonday = today - weekday * DAY_MS
  let from: number | undefined
  let until: number | undefined
  let remaining = lower
  const duration = /(?:最近|过去|近|last|past)\s*(\d{1,3})\s*(?:天|days?)/i.exec(lower)
  const explicitDate = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(lower)
  if (duration) {
    const days = Number(duration[1])
    if (days < 1 || days > 90) throw new Error('time range must be within 1..90 days')
    from = today - (days - 1) * DAY_MS
    remaining = remaining.replace(duration[0], ' ')
  } else if (/(上周|last week)/i.test(lower)) {
    from = thisMonday - 7 * DAY_MS
    until = thisMonday
    remaining = remaining.replace(/上周|last week/gi, ' ')
  } else if (/(本周|这周|this week)/i.test(lower)) {
    from = thisMonday
    remaining = remaining.replace(/本周|这周|this week/gi, ' ')
  } else if (/(昨天|yesterday)/i.test(lower)) {
    from = today - DAY_MS
    until = today
    remaining = remaining.replace(/昨天|yesterday/gi, ' ')
  } else if (/(今天|today)/i.test(lower)) {
    from = today
    remaining = remaining.replace(/今天|today/gi, ' ')
  } else if (explicitDate) {
    const [year, month, day] = explicitDate.slice(1).map(Number)
    const chosen = new Date(year!, month! - 1, day!)
    if (chosen.getFullYear() !== year || chosen.getMonth() !== month! - 1
      || chosen.getDate() !== day || chosen.getTime() > nowMs) {
      throw new Error('invalid or future date')
    }
    from = chosen.getTime()
    until = from + DAY_MS
    remaining = remaining.replace(explicitDate[0], ' ')
  }

  const ignored = /(?:which|where|what|when|how|did|i|my|me|the|are|was|were|in|on|at|for|with|from|about|show|find|list|please|recent|history|work|worked|project|projects|file|files|application|applications|app|apps|save|saved|changed|edit|edited|test|tests|build|builds|this|week|last|past|today|yesterday|using|used|workspaces?)\b/gi
  remaining = remaining.replace(ignored, ' ')
    .replace(/上周|本周|这周|今天|昨天|最近|过去|近|哪些|哪个|什么|哪里|在哪|多少|时候|我|的|了|在|做|工作|项目|工程|软件|应用|文件|文档|代码|改过|改了|修改|保存|测试|构建|验证|通过|失败|使用|查看|帮|请|找|一下|记录|历史|有|和|是|吗|呢|能/g, ' ')
  const terms = [...new Set(
    (remaining.match(/[a-z0-9_./:\\-]{2,}|[\p{Script=Han}]{2,}/giu) ?? [])
      .map(term => term.toLocaleLowerCase())
      .filter(term => term.length <= 128)
  )].slice(0, 12)
  return {
    intent,
    ...(from === undefined ? {} : { from }),
    ...(until === undefined ? {} : { until }),
    terms,
  }
}

type Candidate = {
  hit: HistorySearchHit
  text: string
  weight: number
}

function hitId(episodeId: string, kind: string, subject: string): string {
  return 'ah_' + createHash('sha256')
    .update(episodeId + '\u0000' + kind + '\u0000' + subject).digest('hex')
}

function basename(uri: string): string {
  return uri.replace(/\\/g, '/').split('/').at(-1)?.slice(0, 256) || uri.slice(0, 256)
}

function candidates(episode: EpisodeSummary): readonly Candidate[] {
  const id = String(episode.id)
  const workspaceTitle = episode.workspace?.title?.slice(0, 256)
    || episode.workspace?.root?.replace(/\\/g, '/').split('/').at(-1)?.slice(0, 256)
  const common = {
    episodeId: id,
    ...(workspaceTitle ? { workspaceTitle } : {}),
    ...(episode.threadKey ? { projectMemoryId: memoryIdForThreadKey(episode.threadKey) } : {}),
    evidenceLevel: episodeEvidenceLevel(episode),
  }
  const all: Candidate[] = []
  const add = (kind: HistorySearchHit['kind'], title: string, subject: string,
    when: number, searchable: string, weight: number,
    resourceUri?: string): void => {
    all.push({
      hit: {
        ...common,
        id: hitId(id, kind, subject),
        kind, title: title.slice(0, 256),
        observedAtMs: when,
        ...(resourceUri ? { resourceUri } : {}),
        provenance: kind === 'verification'
          ? 'Historical test/build report from trusted editor metadata; current state unverified'
          : 'Recorded application/workspace/resource metadata; not file or page contents',
      },
      text: searchable.toLocaleLowerCase(),
      weight,
    })
  }

  if (workspaceTitle || episode.workspace?.root) {
    const title = workspaceTitle ?? 'Unnamed workspace'
    add('workspace', title, episode.threadKey || episode.workspace?.root || id,
      episode.endedAtMs,
      [title, episode.workspace?.root, episode.workspace?.id].filter(Boolean).join(' '), 6)
  }
  for (const resource of episode.resources) {
    add('file', resource.displayLabel || basename(resource.canonicalUri),
      resource.canonicalUri, resource.lastSeenAtMs,
      [resource.canonicalUri, resource.displayLabel, workspaceTitle,
        episode.workspace?.root].filter(Boolean).join(' '), 4, resource.canonicalUri)
  }
  for (const resource of episode.changedResources ?? []) {
    add('save', resource.displayLabel || basename(resource.canonicalUri),
      resource.canonicalUri, resource.lastChangedAtMs,
      [resource.canonicalUri, resource.displayLabel, workspaceTitle,
        episode.workspace?.root].filter(Boolean).join(' '), 7, resource.canonicalUri)
  }
  for (const app of episode.surfaces) {
    add('application', app.bundleId, app.bundleId,
      app.lastSeenAtMs, [app.bundleId, workspaceTitle].filter(Boolean).join(' '), 3)
  }
  for (const event of episode.verifications ?? []) {
    add('verification', event.kind + ': ' + event.result,
      event.kind + event.result, event.lastObservedAtMs,
      [event.kind, event.result, workspaceTitle,
        event.kind === 'test' ? '测试' : event.kind === 'build' ? '构建' : '验证',
        event.result === 'success' ? '成功 通过 passed' : '失败 failed',
      ].filter(Boolean).join(' '), 5)
  }
  return all
}

const kindIntent: Record<HistoryQuestionIntent, readonly HistorySearchHit['kind'][]> = {
  projects: ['workspace'],
  files: ['file', 'save'],
  saves: ['save'],
  checks: ['verification'],
  applications: ['application'],
  overview: ['workspace', 'file', 'save', 'application', 'verification'],
}

/**
 * No LLM, network call, new collection, or access to user-confirmed notes.
 * Every answer item must point to an actually retained Episode.
 */
export function askHistoryFromEpisodes(
  episodes: readonly EpisodeSummary[],
  request: AskHistoryRequest,
  nowMs: number,
): AskHistoryResult {
  if (typeof request.query !== 'string'
    || !request.query.trim() || request.query.length > 300) {
    throw new Error('history question must be 1..300 characters')
  }
  const limit = request.limit ?? 10
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    throw new Error('history question limit must be 1..20')
  }
  const parsed = interpretHistoryQuestion(request.query, nowMs)
  const chosen = episodes
    .filter(ep => ep.state !== 'invalidated' && ep.startedAtMs <= nowMs)
    .filter(ep => (parsed.from === undefined || ep.endedAtMs >= parsed.from)
      && (parsed.until === undefined || ep.startedAtMs < parsed.until))
  const kindSet = new Set(kindIntent[parsed.intent])
  const all = chosen.flatMap(episode => candidates(episode)
    .filter(candidate => kindSet.has(candidate.hit.kind))
    .map(candidate => {
      const matches = parsed.terms.reduce((count, term) =>
        count + (candidate.text.includes(term) ? 1 : 0), 0)
      return { hit: candidate.hit, weight: candidate.weight, matches }
    })
    .filter(candidate => parsed.terms.length === 0 || candidate.matches > 0))
  const ordered = all.toSorted((a, b) =>
    b.matches - a.matches || b.weight - a.weight
    || b.hit.observedAtMs - a.hit.observedAtMs || a.hit.id.localeCompare(b.hit.id))
  // Deduplicate one subject across multiple Episodes, while keeping its most
  // relevant actual Episode provenance. Never merge unlike workspace identities.
  const unique = new Set<string>()
  const items: HistorySearchHit[] = []
  for (const candidate of ordered) {
    const item = candidate.hit
    const key = item.kind + '\u0000' + (item.projectMemoryId ?? item.workspaceTitle ?? '')
      + '\u0000' + (item.resourceUri ?? item.title)
    if (unique.has(key)) continue
    unique.add(key)
    items.push(item)
    if (items.length >= limit) break
  }
  return {
    status: items.length ? 'matches' : 'no-evidence',
    question: request.query,
    intent: parsed.intent,
    ...(parsed.from === undefined ? {} : { searchedFromMs: parsed.from }),
    ...(parsed.until === undefined ? {} : { searchedUntilMs: parsed.until }),
    items,
    scannedEpisodes: episodes.length,
    scanTruncated: episodes.length >= MAX_SCANNED,
    notesAccess: 'not-searched',
    caveat: 'Only retained metadata is searched. Results are historical pointers, not proof of current work status. User-confirmed long-term notes are excluded. The scan may be incomplete.',
  }
}
