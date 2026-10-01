import type {
  EpisodeSummary,
  ResumeRequest,
  ResumeResolution,
} from '../../shared/index.js'
import { detectResumeIntent } from './intent.js'
import {
  matchingResourceBasenames,
  queryMentionsWorkspace,
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
    return {
      status: 'hit',
      episode,
      confidence: 1,
      reasons: ['explicit-workspace'],
    }
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
            return {
              status: 'hit',
              episode,
              confidence: 0.95,
              reasons: ['exact-resource', 'current-workspace'],
            }
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
        return {
          status: 'hit',
          episode,
          confidence: 0.95,
          reasons: ['exact-resource'],
        }
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
      return {
        status: 'hit',
        episode,
        confidence: 0.9,
        reasons: ['current-workspace'],
      }
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

      return {
        status: 'hit',
        episode: top.episode,
        confidence: 0.8,
        reasons: ['surface-recency'],
      }
    }
  }

  if (intent.isResume) {
    const episode = latest(eligible)
    if (episode) {
      return {
        status: 'hit',
        episode,
        confidence: 0.7,
        reasons: ['recent-episode'],
      }
    }
  }

  return {
    status: 'none',
    reason: 'query is not eligible for automatic resume',
  }
}
