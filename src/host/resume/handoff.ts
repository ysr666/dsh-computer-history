import type {
  DshCheckpoint,
  EpisodeSummary,
  ResumeHandoff,
  ResumeHandoffCandidate,
  ResumeResolution,
  ResumeThreadTail,
  ResumeUrlDetourBridge,
} from '../../shared/index.js'

export const CHECKPOINT_CONTINUITY_MAX_GAP_MS = 24 * 60 * 60 * 1_000
export const EXPLICIT_THREAD_TAIL_MAX_EPISODES = 3
export const EXPLICIT_THREAD_TAIL_MAX_GAP_MS = 30 * 60 * 1_000
export const EXPLICIT_URL_DETOUR_BRIDGE_MAX_SPAN_MS = 30 * 60 * 1_000

/**
 * Attach a DSH boundary only when it can honestly precede this external work.
 * This policy is shared by Agent handoffs and the UI route so neither surface
 * can claim continuity the other would reject.
 */
export function attachDshCheckpoint(
  handoff: ResumeHandoff,
  checkpoint: DshCheckpoint | undefined,
): ResumeHandoff {
  if (handoff.status !== 'hit' || checkpoint === undefined) return handoff
  const gapMs = handoff.startedAtMs - checkpoint.checkpointAtMs
  if (gapMs < 0 || gapMs > CHECKPOINT_CONTINUITY_MAX_GAP_MS) return handoff
  return { ...handoff, checkpoint }
}

function candidateOf(episode: EpisodeSummary): ResumeHandoffCandidate {
  const lastActiveResource = episode.lastStrongResource ?? episode.resources.at(-1)
  return {
    episodeId: episode.id,
    lastActiveAtMs: episode.endedAtMs,
    ...(episode.threadKey === undefined ? {} : { threadKey: episode.threadKey }),
    ...(episode.workspace === undefined ? {} : { workspace: episode.workspace }),
    ...(lastActiveResource === undefined ? {} : { lastActiveResource }),
  }
}

function citationsOf(
  episode: EpisodeSummary,
): readonly EpisodeSummary['summaryObservationIds'][number][] {
  const direct = (
    episode as EpisodeSummary & {
      readonly observationIds?: EpisodeSummary['summaryObservationIds']
    }
  ).observationIds ?? []
  return direct.length > 0 ? direct : episode.summaryObservationIds
}

function mergeThreadResources(
  episodes: readonly EpisodeSummary[],
): ResumeThreadTail['recentResources'] {
  const merged = new Map<string, {
    resource: ResumeThreadTail['recentResources'][number]
    lastSeenAtMs: number
  }>()
  for (const episode of episodes) {
    for (const resource of episode.resources) {
      const key = resource.kind + '\u0000' + resource.canonicalUri
      const previous = merged.get(key)
      if (!previous || resource.lastSeenAtMs >= previous.lastSeenAtMs) {
        merged.set(key, {
          resource: {
            kind: resource.kind,
            canonicalUri: resource.canonicalUri,
            ...(resource.displayLabel === undefined
              ? {}
              : { displayLabel: resource.displayLabel }),
          },
          lastSeenAtMs: resource.lastSeenAtMs,
        })
      }
    }
  }
  return [...merged.values()]
    .toSorted((left, right) => right.lastSeenAtMs - left.lastSeenAtMs)
    .slice(0, 6)
    .map(value => value.resource)
}

function mergeThreadChangedResources(
  episodes: readonly EpisodeSummary[],
): ResumeThreadTail['changedResources'] {
  const merged = new Map<string, ResumeThreadTail['changedResources'][number]>()
  for (const episode of episodes) {
    for (const resource of episode.changedResources ?? []) {
      const key = resource.kind + '\u0000' + resource.canonicalUri
      const previous = merged.get(key)
      merged.set(key, previous
        ? {
            kind: resource.kind,
            canonicalUri: resource.canonicalUri,
            ...(resource.displayLabel ?? previous.displayLabel
              ? { displayLabel: resource.displayLabel ?? previous.displayLabel }
              : {}),
            lastChangedAtMs: Math.max(
              previous.lastChangedAtMs,
              resource.lastChangedAtMs,
            ),
            changeCount: previous.changeCount + resource.changeCount,
          }
        : resource)
    }
  }
  return [...merged.values()]
    .toSorted((left, right) => right.lastChangedAtMs - left.lastChangedAtMs)
    .slice(0, 6)
}

function mergeThreadVerifications(
  episodes: readonly EpisodeSummary[],
): ResumeThreadTail['verifications'] {
  const merged = new Map<string, ResumeThreadTail['verifications'][number]>()
  for (const episode of episodes) {
    for (const verification of episode.verifications ?? []) {
      const key = verification.kind + ':' + verification.result
      const previous = merged.get(key)
      merged.set(key, previous
        ? {
            kind: verification.kind,
            result: verification.result,
            lastObservedAtMs: Math.max(
              previous.lastObservedAtMs,
              verification.lastObservedAtMs,
            ),
            observationCount:
              previous.observationCount + verification.observationCount,
          }
        : verification)
    }
  }
  return [...merged.values()]
    .toSorted((left, right) => right.lastObservedAtMs - left.lastObservedAtMs)
    .slice(0, 4)
}

/**
 * Build lower-priority context from the immediately preceding Episodes that
 * share the selected Episode's explicit threadKey. This is deliberately
 * conservative: stop at the first large gap and never bridge by time alone.
 */
export function buildPriorThreadTail(
  episodes: readonly EpisodeSummary[],
  anchorEpisodeId: EpisodeSummary['id'],
): ResumeThreadTail | undefined {
  const ordered = [...episodes]
    .toSorted((left, right) =>
      left.startedAtMs - right.startedAtMs
      || String(left.id).localeCompare(String(right.id)),
    )
  const anchorIndex = ordered.findIndex(
    episode => String(episode.id) === String(anchorEpisodeId),
  )
  if (anchorIndex <= 0) return undefined
  const anchor = ordered[anchorIndex]!
  if (!anchor.threadKey) return undefined

  const selected: EpisodeSummary[] = []
  let nextStartedAtMs = anchor.startedAtMs

  for (
    let index = anchorIndex - 1;
    index >= 0 && selected.length < EXPLICIT_THREAD_TAIL_MAX_EPISODES;
    index -= 1
  ) {
    const episode = ordered[index]!
    if (episode.threadKey !== anchor.threadKey) break
    const gapMs = Math.max(0, nextStartedAtMs - episode.endedAtMs)
    if (gapMs > EXPLICIT_THREAD_TAIL_MAX_GAP_MS) break
    if (citationsOf(episode).length === 0) break
    selected.unshift(episode)
    nextStartedAtMs = episode.startedAtMs
  }

  if (selected.length === 0) return undefined

  const recentResources = mergeThreadResources(selected)
  const evidenceObservationIds = [...new Set(
    selected.flatMap(episode => citationsOf(episode)),
  )].toSorted((left, right) => left - right)

  return {
    episodeIds: selected.map(episode => episode.id),
    startedAtMs: selected[0]!.startedAtMs,
    lastActiveAtMs: selected.at(-1)!.endedAtMs,
    recentResources,
    referenceResources: recentResources
      .filter(resource => resource.kind === 'url')
      .slice(0, 4),
    changedResources: mergeThreadChangedResources(selected),
    verifications: mergeThreadVerifications(selected),
    evidenceObservationIds,
  }
}

function isUrlOnlyBrowserEpisode(episode: EpisodeSummary): boolean {
  return episode.workspace === undefined
    && episode.threadKey === undefined
    && episode.resources.length > 0
    && episode.resources.every(resource => resource.kind === 'url')
    && episode.surfaces.length > 0
    && episode.surfaces.every(surface => surface.surfaceKind === 'browser')
}

/**
 * Bridge exactly one browser research detour only when the evidence closes the
 * loop: same explicit thread before and after, workspace-switch boundaries on
 * both sides, and no other Episode recorded in between.
 */
export function buildUrlDetourBridge(
  threadEpisodes: readonly EpisodeSummary[],
  surroundingEpisodes: readonly EpisodeSummary[],
  anchorEpisodeId: EpisodeSummary['id'],
): ResumeUrlDetourBridge | undefined {
  const orderedThread = [...threadEpisodes]
    .toSorted((left, right) =>
      left.startedAtMs - right.startedAtMs
      || String(left.id).localeCompare(String(right.id)),
    )
  const anchorIndex = orderedThread.findIndex(
    episode => String(episode.id) === String(anchorEpisodeId),
  )
  if (anchorIndex <= 0) return undefined

  const anchor = orderedThread[anchorIndex]!
  const previous = orderedThread[anchorIndex - 1]!
  if (
    !anchor.threadKey
    || previous.threadKey !== anchor.threadKey
  ) return undefined

  const spanMs = anchor.startedAtMs - previous.endedAtMs
  if (
    spanMs < 0
    || spanMs > EXPLICIT_URL_DETOUR_BRIDGE_MAX_SPAN_MS
  ) return undefined

  const between = surroundingEpisodes
    .filter(episode =>
      String(episode.id) !== String(previous.id)
      && String(episode.id) !== String(anchor.id)
      && episode.startedAtMs >= previous.endedAtMs
      && episode.endedAtMs <= anchor.startedAtMs,
    )
    .toSorted((left, right) =>
      left.startedAtMs - right.startedAtMs
      || String(left.id).localeCompare(String(right.id)),
    )

  if (between.length !== 1) return undefined
  const detour = between[0]!
  const workspaceSwitchLoop =
    previous.boundary.endReason === 'workspace-switch'
    && anchor.boundary.startReason === 'workspace-switch'
    && detour.boundary.endReason === 'workspace-switch'

  const companionCollectorLoop =
    previous.boundary.endReason === 'collector-restart'
    && detour.boundary.startReason === 'collector-restart'
    && detour.boundary.endReason === 'collector-restart'
    && anchor.boundary.startReason === 'collector-restart'

  if (
    (!workspaceSwitchLoop && !companionCollectorLoop)
    || !isUrlOnlyBrowserEpisode(detour)
  ) return undefined

  const citations = citationsOf(detour)
  if (citations.length === 0) return undefined

  return {
    episodeId: detour.id,
    startedAtMs: detour.startedAtMs,
    lastActiveAtMs: detour.endedAtMs,
    referenceResources: [...detour.resources]
      .toSorted((left, right) => right.lastSeenAtMs - left.lastSeenAtMs)
      .slice(0, 4)
      .map(resource => resource.displayLabel === undefined
        ? {
            kind: resource.kind,
            canonicalUri: resource.canonicalUri,
          }
        : {
            kind: resource.kind,
            canonicalUri: resource.canonicalUri,
            displayLabel: resource.displayLabel,
          }),
    evidenceObservationIds: [...citations],
  }
}

/**
 * Project a resolver result into the product-level handoff an Agent can use.
 *
 * Episodes remain the auditable storage unit. The handoff deliberately omits
 * episode.summary: a generic/generated sentence is weaker evidence than the
 * structured workspace, resources, surfaces and observation citations that a
 * continuation can verify against authoritative sources.
 */
export function buildResumeHandoffFromEpisode(
  episode: EpisodeSummary,
): ResumeHandoff {
  // Explicit Continue starts from one exact stored Episode. Its structured
  // workspace/resource/save/verification fields are derived from the Episode's
  // original observation provenance, not from summary prose. Prefer those raw
  // citations when the caller supplied an EpisodeDetail; fall back to summary
  // citations for older/summary-only callers.
  const directCitations = (
    episode as EpisodeSummary & {
      readonly observationIds?: EpisodeSummary['summaryObservationIds']
    }
  ).observationIds ?? []
  const citations = directCitations.length > 0
    ? directCitations
    : episode.summaryObservationIds
  if (citations.length === 0) {
    return { status: 'none', reason: 'episode has no auditable evidence' }
  }
  const resource = episode.lastStrongResource
    ?? [...episode.resources]
      .toSorted((left, right) => right.lastSeenAtMs - left.lastSeenAtMs)[0]
  return buildResumeHandoff({
    status: 'hit',
    episode,
    confidence: episode.confidence,
    reasons: ['recent-episode'],
    ...(resource === undefined ? {} : { resource }),
    citations: citations as readonly [typeof citations[number], ...typeof citations[number][]],
  })
}

export function buildResumeHandoff(
  resolution: ResumeResolution,
): ResumeHandoff {
  if (resolution.status === 'none') {
    return { status: 'none', reason: resolution.reason }
  }

  if (resolution.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      reason: resolution.reason,
      candidates: resolution.candidates.map(candidateOf),
    }
  }

  const episode = resolution.episode
  const recentResources = [...episode.resources]
    .toSorted((left, right) => right.lastSeenAtMs - left.lastSeenAtMs)
    .slice(0, 8)
    .map(({ kind, canonicalUri, displayLabel }) =>
      displayLabel === undefined
        ? { kind, canonicalUri }
        : { kind, canonicalUri, displayLabel })

  const referenceResources = [...episode.resources]
    .filter(resource => resource.kind === 'url')
    .toSorted((left, right) => right.lastSeenAtMs - left.lastSeenAtMs)
    .slice(0, 8)
    .map(({ kind, canonicalUri, displayLabel }) =>
      displayLabel === undefined
        ? { kind, canonicalUri }
        : { kind, canonicalUri, displayLabel })

  const changedResources = [...(episode.changedResources ?? [])]
    .toSorted((left, right) => right.lastChangedAtMs - left.lastChangedAtMs)
    .slice(0, 8)

  const verifications = [...(episode.verifications ?? [])]
    .toSorted((left, right) => right.lastObservedAtMs - left.lastObservedAtMs)
    .slice(0, 8)

  const surfaces = [...episode.surfaces]
    .toSorted((left, right) => right.lastSeenAtMs - left.lastSeenAtMs)
    .slice(0, 8)

  return {
    status: 'hit',
    episodeId: episode.id,
    startedAtMs: episode.startedAtMs,
    lastActiveAtMs: episode.endedAtMs,
    ...(episode.threadKey === undefined ? {} : { threadKey: episode.threadKey }),
    ...(episode.workspace === undefined ? {} : { workspace: episode.workspace }),
    ...(resolution.resource === undefined
      ? {}
      : { lastActiveResource: resolution.resource }),
    recentResources,
    referenceResources,
    changedResources,
    verifications,
    surfaces,
    confidence: resolution.confidence,
    reasons: resolution.reasons,
    evidenceObservationIds: resolution.citations,
  }
}
