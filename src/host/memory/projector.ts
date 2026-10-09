import { createHash } from 'node:crypto'
import type {
  EpisodeSummary,
  ListProjectMemoriesRequest,
  MemoryFact,
  MemoryFactKind,
  ProjectMemory,
} from '../../shared/index.js'
import { memoryEvidenceLevel } from './evidence.js'

const ACTIVE_MS = 7 * 86_400_000

function opaqueId(prefix: string, value: string): string {
  return prefix + createHash('sha256')
    .update('dch-work-memory-v1\u0000' + value)
    .digest('hex')
}

/** One stable opaque locator for an already-evidenced Work Thread. */
export function memoryIdForThreadKey(threadKey: string): string {
  return opaqueId('pm_', threadKey)
}

function basename(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.replace(/\\/g, '/').replace(/\/+$/, '').split('/').at(-1)?.slice(0, 256)
}

interface FactSource {
  kind: MemoryFactKind
  key: string
  text: string
  at: number
  episodes: EpisodeSummary[]
}

function buildOne(key: string, episodes: readonly EpisodeSummary[], nowMs: number): ProjectMemory {
  const recent = [...episodes].toSorted((a, b) =>
    b.endedAtMs - a.endedAtMs || String(a.id).localeCompare(String(b.id)))
  const title = recent.map(e =>
    e.workspace?.title?.trim().slice(0, 256) || basename(e.workspace?.root))
    .find(Boolean) ?? 'Unnamed workspace'
  const sources = new Map<string, FactSource>()

  function add(kind: MemoryFactKind, subject: string, text: string,
    episode: EpisodeSummary, at: number): void {
    const factKey = kind + '\u0000' + subject
    const old = sources.get(factKey)
    if (old) {
      if (!old.episodes.includes(episode)) old.episodes.push(episode)
      old.at = Math.max(old.at, at)
    } else {
      sources.set(factKey, { kind, key: factKey, text, at, episodes: [episode] })
    }
  }

  for (const episode of recent) {
    add('workspace', 'identity', 'Workspace: ' + title, episode, episode.endedAtMs)
    for (const surface of episode.surfaces) {
      add('activity', surface.bundleId, 'Observed app: ' + surface.bundleId,
        episode, surface.lastSeenAtMs)
    }
    for (const resource of episode.resources) {
      const label = resource.displayLabel?.trim().slice(0, 256)
        || basename(resource.canonicalUri) || resource.kind
      add('resource', resource.kind + ':' + resource.canonicalUri,
        'Recently used: ' + label, episode, resource.lastSeenAtMs)
    }
    for (const changed of episode.changedResources ?? []) {
      const label = changed.displayLabel?.trim().slice(0, 256)
        || basename(changed.canonicalUri) || changed.kind
      add('save', changed.kind + ':' + changed.canonicalUri,
        'Observed save: ' + label, episode, changed.lastChangedAtMs)
    }
    for (const verification of episode.verifications ?? []) {
      const outcome = verification.kind + ' ' + verification.result
      add('verification', outcome,
        'Historically observed ' + outcome + ' (recheck current state)',
        episode, verification.lastObservedAtMs)
    }
  }

  const order: Record<MemoryFactKind, number> = {
    workspace: 0, save: 1, verification: 2, resource: 3, activity: 4,
  }
  const facts: MemoryFact[] = [...sources.values()]
    .toSorted((a, b) =>
      order[a.kind] - order[b.kind] || b.at - a.at || a.key.localeCompare(b.key))
    .filter((value, _index, all) => {
      const max = value.kind === 'workspace' ? 1
        : value.kind === 'save' ? 4
        : value.kind === 'verification' ? 4
        : value.kind === 'resource' ? 5 : 4
      return all.filter(x => x.kind === value.kind).indexOf(value) < max
    })
    .slice(0, 18)
    .map(source => ({
      id: opaqueId('mf_', key + '\u0000' + source.key),
      kind: source.kind,
      text: source.text,
      sourceEpisodeIds: source.episodes.map(e => String(e.id)),
      evidenceLevel: memoryEvidenceLevel(source.episodes),
      observedAtMs: source.at,
    }))
  const last = recent[0]!.endedAtMs
  return {
    id: memoryIdForThreadKey(key),
    title,
    lastActiveAtMs: last,
    episodeCount: recent.length,
    recentEpisodeIds: recent.slice(0, 6).map(e => String(e.id)),
    facts,
    status: last >= nowMs - ACTIVE_MS ? 'active' : 'stale',
  }
}

/** Deterministic and read-only for a supplied clock; no new collectors or storage. */
export function buildProjectMemories(
  episodes: readonly EpisodeSummary[],
  request: ListProjectMemoriesRequest = {},
  nowMs: number,
): readonly ProjectMemory[] {
  const groups = new Map<string, EpisodeSummary[]>()
  for (const episode of episodes) {
    if (episode.state === 'invalidated' || !episode.threadKey) continue
    const members = groups.get(episode.threadKey)
    if (members) members.push(episode)
    else groups.set(episode.threadKey, [episode])
  }
  const query = request.query?.trim().toLocaleLowerCase()
  const matches = (members: readonly EpisodeSummary[]): boolean => !query
    || members.some(episode =>
      episode.workspace?.title?.toLocaleLowerCase().includes(query)
      || episode.workspace?.root?.toLocaleLowerCase().includes(query)
      || episode.surfaces.some(surface => surface.bundleId.toLocaleLowerCase().includes(query))
      || episode.resources.some(resource =>
        resource.canonicalUri.toLocaleLowerCase().includes(query)
        || resource.displayLabel?.toLocaleLowerCase().includes(query))
      || (episode.changedResources ?? []).some(resource =>
        resource.canonicalUri.toLocaleLowerCase().includes(query)
        || resource.displayLabel?.toLocaleLowerCase().includes(query)))
  return [...groups.entries()]
    .filter(([, members]) => matches(members))
    .map(([key, members]) => buildOne(key, members, nowMs))
    .toSorted((a, b) => b.lastActiveAtMs - a.lastActiveAtMs || a.id.localeCompare(b.id))
    .slice(0, request.limit ?? 20)
}
