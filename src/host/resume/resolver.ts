import type {
  EpisodeSummary,
  ObservationId,
  ResumeReason,
  ResumeRequest,
  ResumeResolution,
} from '../../shared/index.js'
import { isGenericContinuationCandidate } from '../../shared/index.js'
import { detectResumeIntent } from './intent.js'
import {
  matchingResourceBasenames,
  queryMentionsWorkspace,
  resourceBasename,
  surfaceLastSeenAt,
  workspaceIdentity,
} from './scoring.js'

function latest(
  episodes: readonly EpisodeSummary[],
): EpisodeSummary | undefined {
  return episodes.toSorted(
    (left, right) => right.endedAtMs - left.endedAtMs,
  )[0]
}

/**
 * A hit is only a hint when a reader can check it (ADR 0004 §5): the citations
 * come from the episode's own evidence, the resource is the one a person would
 * reopen, and an episode without citations cannot produce a hit at all.
 */
function hitResolution(
  episode: EpisodeSummary,
  confidence: number,
  reasons: readonly ResumeReason[],
  preferredResource?: EpisodeSummary['resources'][number],
): ResumeResolution | undefined {
  const citations = episode.summaryObservationIds
  if (citations.length === 0) return undefined
  const [first, ...rest] = citations
  const resource = preferredResource
    ?? episode.lastStrongResource
    ?? episode.resources.at(-1)
  return {
    status: 'hit',
    episode,
    confidence,
    reasons,
    ...(resource ? { resource } : {}),
    citations: [first as ObservationId, ...rest],
  }
}

function noCitations(): ResumeResolution {
  return {
    status: 'none',
    reason: 'the best match has no citations, so it is not a hint',
  }
}

export function resolveResume(
  episodes: readonly EpisodeSummary[],
  request: ResumeRequest,
): ResumeResolution {
  const eligible = episodes.filter(
    (episode) => episode.state === 'closed',
  )

  if (eligible.length === 0) {
    return {
      status: 'none',
      reason: 'no eligible recent episodes',
    }
  }

  const explicitWorkspace = eligible.filter((episode) =>
    queryMentionsWorkspace(request.query, episode),
  )

  if (explicitWorkspace.length > 0) {
    const episode = latest(explicitWorkspace)
    if (!episode) {
      return { status: 'none', reason: 'workspace episode unavailable' }
    }
    return hitResolution(episode, 1, ['explicit-workspace'])
      ?? noCitations()
  }

  const resourceMatches = eligible
    .map((episode) => ({
      episode,
      names: matchingResourceBasenames(request.query, episode),
    }))
    .filter((item) => item.names.length > 0)

  if (resourceMatches.length > 0) {
    const matchedNames = new Set(
      resourceMatches.flatMap((item) => item.names),
    )

    for (const name of matchedNames) {
      const owners = resourceMatches
        .filter((item) => item.names.includes(name))
        .map((item) => item.episode)

      const workspaceOwners = new Set(
        owners.map(workspaceIdentity),
      )

      if (workspaceOwners.size > 1) {
        if (request.currentWorkspaceId) {
          const inCurrent = owners.filter(
            (episode) =>
              episode.workspace?.id === request.currentWorkspaceId,
          )
          const episode = latest(inCurrent)
          if (episode) {
            const preferredResource = episode.resources
              .filter(resource => resourceBasename(resource) === name)
              .toSorted((left, right) => right.lastSeenAtMs - left.lastSeenAtMs)[0]
            return hitResolution(
              episode,
              0.95,
              ['exact-resource', 'current-workspace'],
              preferredResource,
            ) ?? noCitations()
          }
        }

        return {
          status: 'ambiguous',
          candidates: owners.toSorted(
            (left, right) => right.endedAtMs - left.endedAtMs,
          ),
          reason: `resource ${name} exists in multiple workspaces`,
        }
      }

      const episode = latest(owners)
      if (episode) {
        const preferredResource = episode.resources
          .filter(resource => resourceBasename(resource) === name)
          .toSorted((left, right) => right.lastSeenAtMs - left.lastSeenAtMs)[0]
        return hitResolution(
          episode,
          0.95,
          ['exact-resource'],
          preferredResource,
        ) ?? noCitations()
      }
    }
  }

  const intent = detectResumeIntent(request.query)

  if (intent.isResume && request.currentWorkspaceId) {
    const current = eligible.filter(
      (episode) =>
        episode.workspace?.id === request.currentWorkspaceId,
    )
    const episode = latest(current)
    if (episode) {
      return hitResolution(episode, 0.9, ['current-workspace'])
      ?? noCitations()
    }
  }

  if (intent.isResume && intent.surface) {
    const surfaced = eligible
      .map((episode) => ({
        episode,
        atMs: surfaceLastSeenAt(episode, intent.surface!),
      }))
      .filter(
        (item): item is { episode: EpisodeSummary; atMs: number } =>
          item.atMs !== undefined,
      )
      .toSorted((left, right) => right.atMs - left.atMs)

    const top = surfaced[0]
    if (top) {
      const second = surfaced[1]
      if (
        second
        && second.atMs === top.atMs
        && workspaceIdentity(second.episode)
          !== workspaceIdentity(top.episode)
      ) {
        return {
          status: 'ambiguous',
          candidates: [top.episode, second.episode],
          reason: 'surface recency is tied across workspaces',
        }
      }

      return hitResolution(top.episode, 0.8, ['surface-recency'])
        ?? noCitations()
    }
  }

  if (intent.isResume) {
    const episode = latest(eligible.filter(isGenericContinuationCandidate))
    if (episode) {
      return hitResolution(episode, 0.7, ['recent-episode'])
      ?? noCitations()
    }
  }

  return {
    status: 'none',
    reason: 'query is not eligible for automatic resume',
  }
}
