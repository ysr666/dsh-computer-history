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
  readonly surfaceKind:
    EpisodeSurfaceSummary['surfaceKind']
  /** The last title seen for this surface; the observation only carries one for adapters that record titles. */
  title?: string
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

function isUnanchoredEpisode(episode: MutableEpisode): boolean {
  return episode.workspace === undefined
    && episode.resources.size === 0
}

function resourceKey(resource: ResourceIdentity): string {
  return `${resource.kind}\u0000${resource.canonicalUri}`
}

function surfaceKey(
  observation: ActivityObservation,
): string {
  return `${observation.app.bundleId}\u0000${observation.surface.kind}`
}

function observationKey(
  observation: PersistedActivityObservation,
): string {
  return `${observation.collectorSessionId}\u0000${observation.seq}`
}

function workspaceMatches(
  episode: MutableEpisode,
  observation: ActivityObservation,
): boolean {
  if (!episode.workspace) return false

  if (episode.workspace.id && observation.workspace.id) {
    return episode.workspace.id === observation.workspace.id
  }

  if (
    episode.workspace.root
    && observation.workspace.root
  ) {
    return episode.workspace.root
      === observation.workspace.root
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
    collectorSessionId:
      String(observation.collectorSessionId),
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
      existing.lastSeenAtMs =
        observation.observedAtMs
      existing.observationCount += 1
      if (observation.resource.displayLabel) {
        existing.displayLabel =
          observation.resource.displayLabel
      }
    } else {
      episode.resources.set(key, {
        kind: observation.resource.kind,
        canonicalUri:
          observation.resource.canonicalUri,
        ...(observation.resource.displayLabel
          ? {
              displayLabel:
                observation.resource.displayLabel,
            }
          : {}),
        firstSeenAtMs: observation.observedAtMs,
        lastSeenAtMs: observation.observedAtMs,
        observationCount: 1,
      })
    }
  }

  const key = surfaceKey(observation)
  const title = observation.surface.title
  const existingSurface = episode.surfaces.get(key)
  if (existingSurface) {
    existingSurface.lastSeenAtMs =
      observation.observedAtMs
    existingSurface.observationCount += 1
    if (title) {
      existingSurface.title = title
    }
  } else {
    episode.surfaces.set(key, {
      bundleId: observation.app.bundleId,
      surfaceKind: observation.surface.kind,
      ...(title ? { title } : {}),
      firstSeenAtMs: observation.observedAtMs,
      lastSeenAtMs: observation.observedAtMs,
      observationCount: 1,
    })
  }
}

function firstValues<T>(
  values: Iterable<T>,
  limit: number,
): T[] {
  const result: T[] = []
  for (const value of values) {
    result.push(value)
    if (result.length >= limit) break
  }
  return result
}

function finishEpisode(
  episode: MutableEpisode,
  endReason: EpisodeBoundaryReason,
  projection: 'full' | 'compact' = 'full',
): EpisodeDetail {
  const summaryResources = firstValues(
    episode.resources.values(),
    8,
  )
  const summarySurfaces = firstValues(
    episode.surfaces.values(),
    8,
  )
  const resources: EpisodeResourceSummary[] =
    projection === 'full'
      ? [...episode.resources.values()]
      : []
  const surfaces: EpisodeSurfaceSummary[] =
    projection === 'full'
      ? [...episode.surfaces.values()]
      : []

  const workspace = episode.workspace
    ? {
        ...(episode.workspace.id
          ? { id: episode.workspace.id }
          : {}),
        ...(episode.workspace.root
          ? { root: episode.workspace.root }
          : {}),
        ...(episode.workspace.title
          ? { title: episode.workspace.title }
          : {}),
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
    ...(episode.threadKey
      ? { threadKey: episode.threadKey }
      : {}),
    summaryKind: 'deterministic',
    // The deterministic summary is a function of exactly these observations,
    // so they are its citations.
    summaryObservationIds: episode.observationIds,
    summary: renderDeterministicSummary({
      ...(workspace?.title
        ? { workspaceTitle: workspace.title }
        : {}),
      resources: summaryResources,
      surfaces: summarySurfaces,
    }),
    ...(episode.lastStrongResource
      ? {
          lastStrongResource:
            episode.lastStrongResource,
        }
      : {}),
    resources,
    surfaces,
    confidence: episode.confidence,
    state: 'closed',
    observationIds: episode.observationIds,
  }
}

function isEligible(
  observation: PersistedActivityObservation,
): boolean {
  return !observation.privacy.secure
    && !observation.privacy.protected
}

function sortedUnique(
  input: readonly PersistedActivityObservation[],
): PersistedActivityObservation[] {
  const unique = new Map<
    string,
    PersistedActivityObservation
  >()

  for (const observation of input) {
    const key = observationKey(observation)
    const existing = unique.get(key)
    if (
      existing
      && !isDeepStrictEqual(existing, observation)
    ) {
      throw new Error(
        `conflicting duplicate observation for ${observation.collectorSessionId}:${observation.seq}`,
      )
    }
    if (!existing) unique.set(key, observation)
  }

  return [...unique.values()].toSorted(
    (left, right) =>
      left.observedAtMs - right.observedAtMs
      || String(left.collectorSessionId).localeCompare(
        String(right.collectorSessionId),
      )
      || left.seq - right.seq,
  )
}

export class IncrementalEpisodeBuilder {
  private active: MutableEpisode | undefined
  private lastObservedAtMs: number | undefined

  public constructor(
    seed: readonly PersistedActivityObservation[] = [],
  ) {
    for (const observation of sortedUnique(seed)) {
      this.push(observation, { emission: 'none' })
    }
  }

  public get lastObservedAt(): number | undefined {
    return this.lastObservedAtMs
  }

  public push(
    observation: PersistedActivityObservation,
    options: {
      readonly emission?:
        | 'full'
        | 'compact'
        | 'boundaries'
        | 'none'
    } = {},
  ): readonly EpisodeDetail[] {
    // Identity de-duplication lives at the input boundaries, not in the
    // long-lived builder. Batch replay goes through sortedUnique(), while live
    // ingestion checks SQLite's UNIQUE(collector_session, collector_seq)
    // before calling push(). Keeping every full observation here duplicated the
    // entire configurable raw-retention window in RAM for no additional safety.
    if (
      this.lastObservedAtMs !== undefined
      && observation.observedAtMs
        < this.lastObservedAtMs
    ) {
      throw new Error(
        'out-of-order observation requires episode builder reseed',
      )
    }

    this.lastObservedAtMs = observation.observedAtMs

    if (!isEligible(observation)) return []

    const changed: EpisodeDetail[] = []
    const emission = options.emission ?? 'full'
    let startReason:
      EpisodeBoundaryReason = 'first-observation'

    const emit = (
      episode: MutableEpisode,
      reason: EpisodeBoundaryReason,
      boundary: boolean,
    ): void => {
      if (emission === 'none') return
      if (emission === 'boundaries' && !boundary) return
      changed.push(finishEpisode(
        episode,
        reason,
        emission === 'compact' ? 'compact' : 'full',
      ))
    }

    const close = (
      reason: EpisodeBoundaryReason,
    ): void => {
      if (!this.active) return
      emit(this.active, reason, true)
      this.active = undefined
    }

    const emitActive = (): void => {
      if (!this.active) return
      emit(this.active, 'timeout', false)
    }

    if (
      this.active
      && String(observation.collectorSessionId)
        !== this.active.collectorSessionId
    ) {
      close('collector-restart')
      startReason = 'collector-restart'
    }

    if (
      this.active
      && observationForcesIdleBoundary(observation)
    ) {
      close('idle')
      startReason = 'idle'
    }

    if (
      this.active
      && observation.observedAtMs
        - this.active.lastIncludedAtMs
        >= 480_000
    ) {
      close('timeout')
      startReason = 'timeout'
    }

    const strong = hasStrongWorkspace(observation)

    if (strong) {
      if (!this.active) {
        this.active = startEpisode(
          observation,
          startReason,
          true,
        )
        emitActive()
        return changed
      }

      if (
        !this.active.workspace
        || !workspaceMatches(
          this.active,
          observation,
        )
      ) {
        close('workspace-switch')
        this.active = startEpisode(
          observation,
          'workspace-switch',
          true,
        )
        emitActive()
        return changed
      }

      if (
        this.active.detourStartedAtMs !== undefined
        && this.active.lastStrongAtMs !== undefined
        && detourExpired(
          this.active.lastStrongAtMs,
          observation.observedAtMs,
        )
      ) {
        close('timeout')
        this.active = startEpisode(
          observation,
          'timeout',
          true,
        )
        emitActive()
        return changed
      }

      addObservation(
        this.active,
        observation,
        true,
      )
      emitActive()
      return changed
    }

    if (observation.resource?.kind === 'url') {
      if (
        this.active?.workspace
        && this.active.lastStrongAtMs !== undefined
        && observation.observedAtMs
          - this.active.lastStrongAtMs
          <= URL_ATTACH_WINDOW_MS
      ) {
        addObservation(
          this.active,
          observation,
          false,
        )
        emitActive()
        return changed
      }

      if (
        this.active
        && !this.active.workspace
        && observation.observedAtMs
          - this.active.lastIncludedAtMs
          <= URL_ATTACH_WINDOW_MS
      ) {
        addObservation(
          this.active,
          observation,
          false,
        )
        emitActive()
        return changed
      }

      if (this.active) close('workspace-switch')
      this.active = startEpisode(
        observation,
        startReason,
        false,
      )
      emitActive()
      return changed
    }

    if (observation.resource) {
      // A resource-bearing observation without a strong workspace used to
      // close and restart the episode unconditionally, so outside a DSH
      // workspace (most real use) every observation became its own episode
      // and the boundary was labelled "workspace-switch" although no
      // workspace was ever observed. Measured, Cursor 3.23.12: two
      // observations of one file 5.9s apart produced two episodes.
      //
      // The same resource continues the episode. A different resource still
      // starts a new one: a missing workspace is not evidence that two
      // resources belong to the same work, and per-resource episodes are the
      // documented model.
      const continuesSameResource =
        this.active !== undefined
        && observation.resource !== undefined
        && this.active.resources.has(
          resourceKey(observation.resource),
        )
        && (
          this.active.workspace === undefined
          || workspaceMatches(this.active, observation)
        )

      if (this.active && continuesSameResource) {
        addObservation(this.active, observation, false)
        emitActive()
        return changed
      }

      if (this.active) close('workspace-switch')
      this.active = startEpisode(
        observation,
        startReason,
        false,
      )
      emitActive()
      return changed
    }

    // No resource and no strong workspace: the observation still describes work, it just cannot name it.
    // Windows is made entirely of these - UI Automation exposes no document path, the browser companion may
    // be unpaired and DSH workspaces do not exist there - and excluding them left the timeline empty however
    // long the machine ran (thirteen observations, zero episodes, measured 2026-10-05). The application and
    // the surface are the whole identity available, so they become the thread: the same pair continues the
    // episode, a different pair starts one.
    if (this.active && isUnanchoredEpisode(this.active)) {
      if (this.active.surfaces.has(surfaceKey(observation))) {
        addObservation(
          this.active,
          observation,
          false,
        )
        emitActive()
        return changed
      }

      close('app-switch')
      this.active = startEpisode(
        observation,
        startReason,
        false,
      )
      emitActive()
      return changed
    }

    if (!this.active) {
      this.active = startEpisode(
        observation,
        startReason,
        false,
      )
      emitActive()
      return changed
    }

    if (this.active.detourStartedAtMs === undefined) {
      this.active.detourStartedAtMs =
        observation.observedAtMs
    }

    return changed
  }

  public snapshot(): EpisodeDetail | undefined {
    return this.active
      ? finishEpisode(this.active, 'timeout')
      : undefined
  }
}

export function buildEpisodes(
  input: readonly PersistedActivityObservation[],
): readonly EpisodeDetail[] {
  const episodes = new Map<string, EpisodeDetail>()
  const builder = new IncrementalEpisodeBuilder()

  for (const observation of sortedUnique(input)) {
    for (const episode of builder.push(
      observation,
      { emission: 'boundaries' },
    )) {
      episodes.set(String(episode.id), episode)
    }
  }
  const tail = builder.snapshot()
  if (tail) episodes.set(String(tail.id), tail)

  return [...episodes.values()].toSorted(
    (left, right) =>
      left.startedAtMs - right.startedAtMs
      || String(left.id).localeCompare(String(right.id)),
  )
}
