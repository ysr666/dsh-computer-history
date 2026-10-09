import type {
  EpisodeSummary, RelatedActivity, ThreadActivityLinks,
} from '../../shared/index.js'
import { memoryEvidenceLevel } from './evidence.js'
import { memoryIdForThreadKey } from './projector.js'

const NEARBY_MS = 10 * 60_000
const SCAN_CAP = 1_000
const MAX_LINKS = 20

/** Files only: never use a generic web domain, window title, or app name as
 * evidence for project identity. A URI is matched literally, not by basename. */
function exactFiles(episode: EpisodeSummary): Set<string> {
  const files = [...episode.resources, ...(episode.changedResources ?? [])]
  return new Set(files
    .filter(resource => resource.kind === 'file')
    .map(resource => resource.canonicalUri)
    .filter(uri => uri.length > 0 && uri.length <= 2048
      && (uri.startsWith('file:///') || uri.startsWith('/')
        || /^[A-Za-z]:[\\\\/]/.test(uri))))
}

function distance(a: EpisodeSummary, b: EpisodeSummary): number {
  return Math.max(0, a.startedAtMs - b.endedAtMs, b.startedAtMs - a.endedAtMs)
}

interface Association {
  episode: EpisodeSummary
  anchor: EpisodeSummary
  kind: RelatedActivity['kind']
  sharedResourceUri?: string
}

/**
 * Read-only sidecar, NOT a new thread-key resolver.
 *
 * A candidate must lack an authoritative threadKey. An exact-file link requires
 * the complete URI to be unique among known trusted threads in this scan.
 * For a time-only neighbor, no second trusted project may be near the same
 * candidate. Time-only hints explicitly remain UNATTRIBUTED.
 */
export function buildThreadActivityLinks(
  retainedEpisodes: readonly EpisodeSummary[],
  projectMemoryId: string,
  nowMs: number,
  inputTruncated = false,
): ThreadActivityLinks {
  if (!/^pm_[a-f0-9]{64}$/.test(projectMemoryId)) {
    throw new Error('invalid project memory id')
  }
  const retained = retainedEpisodes
    .filter(e => e.state !== 'invalidated' && e.startedAtMs <= nowMs)
    .slice(0, SCAN_CAP)
  const anchors = retained
    .filter(e => e.threadKey && memoryIdForThreadKey(e.threadKey) === projectMemoryId)
  const ownership = new Map<string, Set<string>>()
  const files = new Map<EpisodeSummary, Set<string>>()
  for (const episode of retained) {
    const uris = exactFiles(episode)
    files.set(episode, uris)
    if (!episode.threadKey) continue
    for (const uri of uris) {
      const owners = ownership.get(uri) ?? new Set<string>()
      owners.add(episode.threadKey)
      ownership.set(uri, owners)
    }
  }

  const links: Association[] = []
  for (const candidate of retained) {
    // Never merge or suggest transferring a second trusted project's Episode.
    if (candidate.threadKey || anchors.length === 0) continue
    const candidateFiles = files.get(candidate) ?? new Set<string>()
    const resourceMatches: Array<{ anchor: EpisodeSummary; uri: string }> = []
    for (const anchor of anchors) {
      for (const uri of candidateFiles) {
        if (!files.get(anchor)?.has(uri)) continue
        if (ownership.get(uri)?.size !== 1) continue
        resourceMatches.push({ anchor, uri })
      }
    }
    if (resourceMatches.length) {
      resourceMatches.sort((a, b) =>
        distance(a.anchor, candidate) - distance(b.anchor, candidate)
        || a.uri.localeCompare(b.uri)
        || String(a.anchor.id).localeCompare(String(b.anchor.id)))
      const match = resourceMatches[0]!
      links.push({
        episode: candidate, anchor: match.anchor,
        kind: 'exact-resource', sharedResourceUri: match.uri,
      })
      continue
    }

    // If both sides name different files, there is contradictory project
    // context: do not fall back to a time-only suggestion.
    if (candidateFiles.size > 0 && anchors.some(anchor =>
      (files.get(anchor)?.size ?? 0) > 0)) continue

    const nearby = retained.filter(ep => ep.threadKey
      && distance(ep, candidate) <= NEARBY_MS)
    const nearbyKeys = new Set(nearby.map(ep => ep.threadKey))
    if (nearbyKeys.size !== 1
      || !nearby.some(ep => memoryIdForThreadKey(ep.threadKey!) === projectMemoryId)) {
      continue
    }
    const closest = anchors.filter(ep => distance(ep, candidate) <= NEARBY_MS)
      .toSorted((a, b) => distance(a, candidate) - distance(b, candidate)
        || String(a.id).localeCompare(String(b.id)))[0]
    if (closest) links.push({
      episode: candidate, anchor: closest, kind: 'nearby-unassigned',
    })
  }
  const ordered = links.toSorted((a, b) =>
    Number(a.kind !== 'exact-resource') - Number(b.kind !== 'exact-resource')
    || b.episode.endedAtMs - a.episode.endedAtMs
    || String(a.episode.id).localeCompare(String(b.episode.id)))
  return {
    projectMemoryId,
    links: ordered.slice(0, MAX_LINKS).map(link => {
      const item: RelatedActivity = {
        episodeId: String(link.episode.id),
        anchorEpisodeId: String(link.anchor.id),
        kind: link.kind,
        attribution: link.kind === 'exact-resource' ? 'resource-linked' : 'unattributed',
        observedAtMs: link.episode.endedAtMs,
        label: link.episode.workspace?.title?.slice(0, 256)
          || link.episode.surfaces[0]?.bundleId || 'Unidentified activity',
        appBundleIds: [...new Set(link.episode.surfaces.map(s => s.bundleId))].slice(0, 8),
        sourceEvidence: memoryEvidenceLevel([link.anchor, link.episode]),
      }
      if (link.sharedResourceUri !== undefined) {
        return Object.assign(item, { sharedResourceUri: link.sharedResourceUri })
      }
      return item
    }),
    scannedEpisodes: retained.length,
    scanTruncated: inputTruncated || retainedEpisodes.length >= SCAN_CAP
      || ordered.length > MAX_LINKS,
    caveat: 'Read-only hints over retained metadata. Shared exact-file identity is evidence, not authoritative project membership. Time-only neighbors are explicitly unattributed. No Work Thread or Continue ranking changes.',
  }
}
