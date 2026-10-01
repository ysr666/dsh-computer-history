import path from 'node:path'
import type {
  EpisodeSummary,
  ResourceIdentity,
} from '../../shared/index.js'
import type { ResumeSurface } from './intent.js'

export function normalizeQuery(value: string): string {
  return value.trim().toLowerCase()
}

function basename(resource: ResourceIdentity): string | undefined {
  if (resource.kind === 'file' || resource.kind === 'directory') {
    try {
      const url = new URL(resource.canonicalUri)
      if (url.protocol === 'file:') {
        return path.basename(decodeURIComponent(url.pathname)).toLowerCase()
      }
    } catch {
      return path.basename(resource.canonicalUri).toLowerCase()
    }
  }

  if (resource.kind === 'url') {
    try {
      const url = new URL(resource.canonicalUri)
      return url.pathname.split('/').findLast((segment) => segment.length > 0)?.toLowerCase()
    } catch {
      return undefined
    }
  }

  return resource.displayLabel?.toLowerCase()
}

export function queryMentionsWorkspace(
  query: string,
  episode: EpisodeSummary,
): boolean {
  const normalized = normalizeQuery(query)
  const candidates = [
    episode.workspace?.id,
    episode.workspace?.title,
  ].filter((value): value is string => Boolean(value))

  return candidates.some((candidate) => {
    const lowered = candidate.trim().toLowerCase()
    return lowered.length >= 2 && normalized.includes(lowered)
  })
}

export function matchingResourceBasenames(
  query: string,
  episode: EpisodeSummary,
): readonly string[] {
  const normalized = normalizeQuery(query)
  const matches = new Set<string>()

  for (const resource of episode.resources) {
    const name = basename(resource)
    if (!name || name.length < 2) continue
    if (normalized.includes(name)) matches.add(name)
  }

  return [...matches]
}

export function workspaceIdentity(
  episode: EpisodeSummary,
): string {
  return episode.workspace?.id
    ?? episode.workspace?.root
    ?? `episode:${episode.id}`
}

export function surfaceLastSeenAt(
  episode: EpisodeSummary,
  surface: ResumeSurface,
): number | undefined {
  const matching = episode.surfaces.filter((item) => {
    if (surface === 'browser') {
      return item.surfaceKind === 'browser'
        || item.bundleId === 'com.google.Chrome'
        || item.bundleId === 'com.apple.Safari'
    }

    if (surface === 'terminal') {
      return item.surfaceKind === 'terminal'
        || item.bundleId === 'com.apple.Terminal'
    }

    if (surface === 'editor') {
      return item.surfaceKind === 'editor'
        || item.bundleId === 'com.microsoft.VSCode'
    }

    return item.surfaceKind === 'document'
      || item.bundleId === 'com.apple.Preview'
  })

  if (matching.length === 0) return undefined
  return Math.max(...matching.map((item) => item.lastSeenAtMs))
}
