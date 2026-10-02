import type {
  EpisodeDetail,
  MinimisedSummaryPayload,
} from '../../shared/index.js'

export type { MinimisedSummaryPayload }

/**
 * What a summary provider is allowed to see (ADR 0004 §4).
 *
 * The rule is subtraction, not redaction: everything that could identify *what*
 * was on screen is removed before anything leaves the process. What remains is
 * shape — which applications, which kinds of resource, how much activity, when
 * in the day, and the basename of the workspace root.
 */
/** The query string and fragment of a URL never survive minimisation. */
function extensionOf(canonicalUri: string): string | undefined {
  const withoutQuery = canonicalUri.split(/[?#]/)[0] ?? ''
  const lastSegment = withoutQuery.split('/').pop() ?? ''
  const dot = lastSegment.lastIndexOf('.')
  if (dot <= 0 || dot === lastSegment.length - 1) return undefined
  return lastSegment.slice(dot + 1).toLowerCase()
}

function basename(value: string): string | undefined {
  const trimmed = value.replace(/\/+$/, '')
  if (trimmed.length === 0) return undefined
  return trimmed.split('/').pop()
}

export function minimiseEpisode(
  episode: EpisodeSummaryInput,
): MinimisedSummaryPayload {
  const kinds = new Set<string>()
  const extensions = new Set<string>()
  for (const resource of episode.resources) {
    kinds.add(resource.kind)
    const extension = extensionOf(resource.canonicalUri)
    if (extension) extensions.add(extension)
  }

  const rootName = episode.workspace?.root
    ? basename(episode.workspace.root)
    : undefined

  const start = new Date(episode.startedAtMs)

  return {
    appBundleIds: [...new Set(episode.surfaces.map(surface => surface.bundleId))]
      .toSorted(),
    surfaceKinds: [...new Set(episode.surfaces.map(surface => surface.surfaceKind))]
      .toSorted(),
    resourceKinds: [...kinds].toSorted(),
    fileExtensions: [...extensions].toSorted(),
    observationCount: episode.observationIds.length,
    startHourOfDay: start.getHours(),
    durationMinutes: Math.max(
      0,
      Math.round((episode.endedAtMs - episode.startedAtMs) / 60_000),
    ),
    ...(rootName ? { workspaceRootName: rootName } : {}),
    hasThread: episode.threadKey !== undefined,
  }
}

/** The fields minimisation needs; a whole episode satisfies it. */
export type EpisodeSummaryInput = Pick<
  EpisodeDetail,
  'resources' | 'surfaces' | 'observationIds' | 'startedAtMs' | 'endedAtMs'
  | 'threadKey' | 'workspace'
>
