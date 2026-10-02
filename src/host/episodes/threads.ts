import type {
  EpisodeSummary,
  ObservationId,
  ResourceIdentity,
  WorkThread,
} from '../../shared/index.js'

/**
 * A work thread: the episodes that belong to one line of work, with the
 * evidence behind them (ADR 0004 §5 — a derivation without citations is not
 * allowed anywhere, threads included).
 */
function resourceKey(resource: ResourceIdentity): string {
  return `${resource.kind}:${resource.canonicalUri}`
}

/**
 * Group episodes into threads by their `threadKey`, newest first.
 *
 * Everything here is deterministic and computed from stored episodes: the
 * summary names the applications and resources the thread touched, and the
 * citations are the union of the episodes' own citations — never more than the
 * evidence supports.
 */
export function buildWorkThreads(
  episodes: readonly EpisodeSummary[],
  options: { readonly limit?: number } = {},
): readonly WorkThread[] {
  const grouped = new Map<string, EpisodeSummary[]>()
  for (const episode of episodes) {
    if (!episode.threadKey) continue
    const bucket = grouped.get(episode.threadKey)
    if (bucket) bucket.push(episode)
    else grouped.set(episode.threadKey, [episode])
  }

  const threads: WorkThread[] = []
  for (const [threadKey, members] of grouped) {
    const ordered = members.toSorted((a, b) => a.startedAtMs - b.startedAtMs)
    const first = ordered[0] as EpisodeSummary
    const last = ordered[ordered.length - 1] as EpisodeSummary

    const resources = new Map<string, ResourceIdentity>()
    for (const episode of ordered) {
      for (const resource of episode.resources) {
        if (!resources.has(resourceKey(resource))) {
          resources.set(resourceKey(resource), {
            kind: resource.kind,
            canonicalUri: resource.canonicalUri,
            ...(resource.displayLabel === undefined
              ? {}
              : { displayLabel: resource.displayLabel }),
          })
        }
      }
    }

    const citations = new Set<ObservationId>()
    for (const episode of ordered) {
      for (const id of episode.summaryObservationIds) citations.add(id)
    }

    const resourceList = [...resources.values()]
    threads.push({
      threadKey,
      episodeIds: ordered.map(episode => String(episode.id)),
      episodeCount: ordered.length,
      startedAtMs: first.startedAtMs,
      endedAtMs: last.endedAtMs,
      resources: resourceList,
      summary: renderThreadSummary({
        ...(first.workspace?.title ? { workspaceTitle: first.workspace.title } : {}),
        episodeCount: ordered.length,
        resources: resourceList,
      }),
      summaryObservationIds: [...citations].toSorted((a, b) => a - b),
    })
  }

  return threads
    .toSorted((a, b) => b.endedAtMs - a.endedAtMs)
    .slice(0, options.limit ?? threads.length)
}

export function renderThreadSummary(input: {
  readonly workspaceTitle?: string
  readonly episodeCount: number
  readonly resources: readonly ResourceIdentity[]
}): string {
  const where = input.workspaceTitle ?? 'an unnamed workspace'
  const labels = input.resources
    .slice(0, 3)
    .map(resource => resource.displayLabel ?? resource.canonicalUri)
  const more = input.resources.length - labels.length
  const touched = labels.length === 0
    ? 'no resources'
    : labels.join(', ') + (more > 0 ? ` and ${more} more` : '')
  return `${input.episodeCount} episode${input.episodeCount === 1 ? '' : 's'} in ${where}, touching ${touched}.`
}
