import { isDeepStrictEqual } from 'node:util'
import {
  EpisodeId,
  URL_ATTACH_WINDOW_MS,
  type ActivityObservation,
  type EpisodeBoundaryReason,
  type EpisodeDetail,
  type EpisodeResourceSummary,
  type EpisodeSurfaceSummary,
  type ObservationId,
  type ResourceIdentity,
  type WorkspaceRef,
} from '../../shared/index.js'
import {
  detourExpired,
  hasStrongWorkspace,
  observationForcesIdleBoundary,
} from './boundary.js'
import { renderDeterministicSummary } from './summary.js'
import { threadKeyForWorkspace } from './thread-key.js'

export type PersistedActivityObservation =
  ActivityObservation & { readonly id: ObservationId }

interface MutableResource {
  readonly kind: ResourceIdentity['kind']
  readonly canonicalUri: string
  displayLabel?: string
  firstSeenAtMs: number
  lastSeenAtMs: number
  observationCount: number
}

interface MutableSurface {
  readonly bundleId: string
  readonly surfaceKind: EpisodeSurfaceSummary['surfaceKind']
  firstSeenAtMs: number
  lastSeenAtMs: number
  observationCount: number
}

interface MutableEpisode {
  readonly id: EpisodeId
  readonly collectorSessionId: string
  readonly startReason: EpisodeBoundaryReason
  readonly startedAtMs: number
  readonly workspace: WorkspaceRef | undefined
  readonly threadKey: string | undefined
  readonly resources: Map<string, MutableResource>
  readonly surfaces: Map<string, MutableSurface>
  readonly observationIds: ObservationId[]
  confidence: number
  lastIncludedAtMs: number
  lastStrongAtMs: number | undefined
  lastStrongResource: ResourceIdentity | undefined
  detourStartedAtMs: number | undefined
}

function resourceKey(resource: ResourceIdentity): string {
  return `${resource.kind}\u0000${resource.canonicalUri}`
}

function surfaceKey(observation: ActivityObservation): string {
  return `${observation.app.bundleId}\u0000${observation.surface.kind}`
}

function workspaceMatches(
  episode: MutableEpisode,
  observation: ActivityObservation,
): boolean {
  if (!episode.workspace) return false

  if (episode.workspace.id && observation.workspace.id) {
    return episode.workspace.id === observation.workspace.id
  }

  if (episode.workspace.root && observation.workspace.root) {
    return episode.workspace.root === observation.workspace.root
  }

  return false
}

function stableEpisodeId(
  observation: PersistedActivityObservation,
): EpisodeId {
  return EpisodeId(
    `episode:${observation.collectorSessionId}:${observation.seq}`,
  )
}

function copyWorkspace(
  workspace: WorkspaceRef,
): WorkspaceRef {
  return {
    ...(workspace.id ? { id: workspace.id } : {}),
    ...(workspace.root ? { root: workspace.root } : {}),
    ...(workspace.title ? { title: workspace.title } : {}),
    source: workspace.source,
    confidence: workspace.confidence,
  }
}

function startEpisode(
  observation: PersistedActivityObservation,
  startReason: EpisodeBoundaryReason,
  owned: boolean,
): MutableEpisode {
  const workspace = owned
    ? copyWorkspace(observation.workspace)
    : undefined

  const episode: MutableEpisode = {
    id: stableEpisodeId(observation),
    collectorSessionId: observation.collectorSessionId,
    startReason,
    startedAtMs: observation.observedAtMs,
    workspace,
    threadKey: workspace
      ? threadKeyForWorkspace(workspace)
      : undefined,
    resources: new Map(),
    surfaces: new Map(),
    observationIds: [],
    confidence: workspace?.confidence ?? 0.4,
    lastIncludedAtMs: observation.observedAtMs,
    lastStrongAtMs: undefined,
    lastStrongResource: undefined,
    detourStartedAtMs: undefined,
  }

  addObservation(episode, observation, owned)
  return episode
}

function addObservation(
  episode: MutableEpisode,
  observation: PersistedActivityObservation,
  strong: boolean,
): void {
  episode.observationIds.push(observation.id)
  episode.lastIncludedAtMs = observation.observedAtMs
  episode.detourStartedAtMs = undefined

  if (strong) {
    episode.lastStrongAtMs = observation.observedAtMs
    if (observation.resource) {
      episode.lastStrongResource = observation.resource
    }
    episode.confidence = Math.max(
      episode.confidence,
      observation.workspace.confidence,
    )
  }

  if (observation.resource) {
    const key = resourceKey(observation.resource)
    const existing = episode.resources.get(key)
    if (existing) {
      existing.lastSeenAtMs = observation.observedAtMs
      existing.observationCount += 1
      if (observation.resource.displayLabel) {
        existing.displayLabel = observation.resource.displayLabel
      }
    } else {
      episode.resources.set(key, {
        kind: observation.resource.kind,
        canonicalUri: observation.resource.canonicalUri,
        ...(observation.resource.displayLabel
          ? { displayLabel: observation.resource.displayLabel }
          : {}),
        firstSeenAtMs: observation.observedAtMs,
        lastSeenAtMs: observation.observedAtMs,
        observationCount: 1,
      })
    }
  }

  const appSurfaceKey = surfaceKey(observation)
  const existingSurface = episode.surfaces.get(appSurfaceKey)
  if (existingSurface) {
    existingSurface.lastSeenAtMs = observation.observedAtMs
    existingSurface.observationCount += 1
  } else {
    episode.surfaces.set(appSurfaceKey, {
      bundleId: observation.app.bundleId,
      surfaceKind: observation.surface.kind,
      firstSeenAtMs: observation.observedAtMs,
      lastSeenAtMs: observation.observedAtMs,
      observationCount: 1,
    })
  }
}

function finishEpisode(
  episode: MutableEpisode,
  endReason: EpisodeBoundaryReason,
): EpisodeDetail {
  const resources: EpisodeResourceSummary[] = [
    ...episode.resources.values(),
  ]

  const surfaces: EpisodeSurfaceSummary[] = [
    ...episode.surfaces.values(),
  ]

  const workspace = episode.workspace
    ? {
        ...(episode.workspace.id ? { id: episode.workspace.id } : {}),
        ...(episode.workspace.root ? { root: episode.workspace.root } : {}),
        ...(episode.workspace.title ? { title: episode.workspace.title } : {}),
      }
    : undefined

  return {
    id: episode.id,
    startedAtMs: episode.startedAtMs,
    endedAtMs: episode.lastIncludedAtMs,
    boundary: {
      startReason: episode.startReason,
      endReason,
    },
    ...(workspace ? { workspace } : {}),
    ...(episode.threadKey ? { threadKey: episode.threadKey } : {}),
    summaryKind: 'deterministic',
    summary: renderDeterministicSummary({
      ...(workspace?.title ? { workspaceTitle: workspace.title } : {}),
      resources,
      surfaces,
    }),
    ...(episode.lastStrongResource
      ? { lastStrongResource: episode.lastStrongResource }
      : {}),
    resources,
    surfaces,
    confidence: episode.confidence,
    state: 'closed',
    observationIds: [...episode.observationIds],
  }
}

function isEligible(
  observation: PersistedActivityObservation,
): boolean {
  return !observation.privacy.secure
    && !observation.privacy.protected
}

export function buildEpisodes(
  input: readonly PersistedActivityObservation[],
): readonly EpisodeDetail[] {
  const unique = new Map<string, PersistedActivityObservation>()
  for (const observation of input) {
    const key = `${observation.collectorSessionId}\u0000${observation.seq}`
    const existing = unique.get(key)
    if (existing && !isDeepStrictEqual(existing, observation)) {
      throw new Error(
        `conflicting duplicate observation for ${observation.collectorSessionId}:${observation.seq}`,
      )
    }
    if (!existing) unique.set(key, observation)
  }

  const observations = [...unique.values()].toSorted((left, right) =>
    left.observedAtMs - right.observedAtMs
    || String(left.collectorSessionId).localeCompare(
      String(right.collectorSessionId),
    )
    || left.seq - right.seq,
  )

  const result: EpisodeDetail[] = []
  let active: MutableEpisode | undefined

  const close = (reason: EpisodeBoundaryReason): void => {
    if (!active) return
    result.push(finishEpisode(active, reason))
    active = undefined
  }

  for (const observation of observations) {
    if (!isEligible(observation)) continue

    let startReason: EpisodeBoundaryReason = 'first-observation'

    if (
      active
      && String(observation.collectorSessionId)
        !== active.collectorSessionId
    ) {
      close('collector-restart')
      startReason = 'collector-restart'
    }

    if (active && observationForcesIdleBoundary(observation)) {
      close('idle')
      startReason = 'idle'
    }

    if (
      active
      && observation.observedAtMs - active.lastIncludedAtMs >= 480_000
    ) {
      close('timeout')
      startReason = 'timeout'
    }

    const strong = hasStrongWorkspace(observation)

    if (strong) {
      if (!active) {
        active = startEpisode(observation, startReason, true)
        continue
      }

      if (!active.workspace || !workspaceMatches(active, observation)) {
        close('workspace-switch')
        active = startEpisode(
          observation,
          'workspace-switch',
          true,
        )
        continue
      }

      if (
        active.detourStartedAtMs !== undefined
        && active.lastStrongAtMs !== undefined
        && detourExpired(
          active.lastStrongAtMs,
          observation.observedAtMs,
        )
      ) {
        close('timeout')
        active = startEpisode(observation, 'timeout', true)
        continue
      }

      addObservation(active, observation, true)
      continue
    }

    if (observation.resource?.kind === 'url') {
      if (
        active?.workspace
        && active.lastStrongAtMs !== undefined
        && observation.observedAtMs - active.lastStrongAtMs
          <= URL_ATTACH_WINDOW_MS
      ) {
        addObservation(active, observation, false)
        continue
      }

      if (
        active
        && !active.workspace
        && observation.observedAtMs - active.lastIncludedAtMs
          <= URL_ATTACH_WINDOW_MS
      ) {
        addObservation(active, observation, false)
        continue
      }

      if (active) close('workspace-switch')
      active = startEpisode(observation, startReason, false)
      continue
    }

    if (observation.resource) {
      if (active) close('workspace-switch')
      active = startEpisode(observation, startReason, false)
      continue
    }

    if (active && active.detourStartedAtMs === undefined) {
      active.detourStartedAtMs = observation.observedAtMs
    }
  }

  close('timeout')
  return result
}
