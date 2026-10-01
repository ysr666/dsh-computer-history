import type { DatabaseSync } from 'node:sqlite'
import {
  EPISODE_RETENTION_MS,
  type EpisodeDetail,
  type NativeObservation,
  type PolicySnapshot,
  type ResourceId,
  type WorkspaceRef,
} from '../../shared/index.js'
import {
  buildEpisodes,
  IncrementalEpisodeBuilder,
} from '../episodes/index.js'
import {
  EpisodeStore,
  ObservationStore,
  ResourceStore,
} from '../store/index.js'
import { normalizeObservation } from './normalize.js'

export interface WorkspaceResolver {
  resolve(
    resourceUri: string | undefined,
  ): Promise<WorkspaceRef>
}

function resourceKey(resource: {
  readonly kind: string
  readonly canonicalUri: string
}): string {
  return resource.kind + '\0' + resource.canonicalUri
}

export class IngestionService {
  private readonly observations: ObservationStore
  private readonly resources: ResourceStore
  private readonly episodes: EpisodeStore
  private builder: IncrementalEpisodeBuilder

  public constructor(
    private readonly db: DatabaseSync,
    private readonly workspaceResolver:
      WorkspaceResolver,
    private readonly policy: () => PolicySnapshot,
    private readonly now: () => number = Date.now,
  ) {
    this.observations = new ObservationStore(db)
    this.resources = new ResourceStore(db)
    this.episodes = new EpisodeStore(db)
    this.builder = new IncrementalEpisodeBuilder(
      this.observations.listAll(),
    )
  }

  public reseed(): void {
    this.builder = new IncrementalEpisodeBuilder(
      this.observations.listAll(),
    )
  }

  public async ingest(
    message: NativeObservation,
  ): Promise<boolean> {
    if (
      this.observations.hasCollectorSequence(
        message.collectorSession,
        message.seq,
      )
    ) {
      return false
    }

    const rawUri =
      message.window?.document ?? message.window?.url
    const workspace =
      await this.workspaceResolver.resolve(rawUri)
    const observation = normalizeObservation(
      message,
      this.policy(),
      this.now(),
      workspace,
    )
    if (!observation) return false

    const outOfOrder =
      this.builder.lastObservedAt !== undefined
      && observation.observedAtMs
        < this.builder.lastObservedAt

    const resourceId = observation.resource
      ? this.resources.upsert(
          observation.resource,
          observation.observedAtMs,
        )
      : undefined

    const observationId = this.observations.insert(
      observation,
      resourceId,
    )
    const persisted =
      this.observations.getById(observationId)

    if (!persisted) {
      throw new Error(
        'persisted observation could not be reloaded',
      )
    }

    if (outOfOrder) {
      this.fullRepair()
      return true
    }

    this.persistBuiltEpisodes(
      this.builder.push(persisted),
    )
    return true
  }

  private fullRepair(): void {
    const all = this.observations.listAll()
    const built = buildEpisodes(all)

    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.episodes.deleteAll()
      this.persistBuiltEpisodes(built)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    this.builder =
      new IncrementalEpisodeBuilder(all)
  }

  private persistBuiltEpisodes(
    built: readonly EpisodeDetail[],
  ): void {
    if (built.length === 0) return

    const ownsTransaction = !this.db.isTransaction
    if (ownsTransaction) {
      this.db.exec('BEGIN IMMEDIATE')
    }

    try {
      for (const episode of built) {
        this.persistEpisode(episode)
      }
      if (ownsTransaction) {
        this.db.exec('COMMIT')
      }
    } catch (error) {
      if (ownsTransaction) {
        this.db.exec('ROLLBACK')
      }
      throw error
    }
  }

  private persistEpisode(
    episode: EpisodeDetail,
  ): void {
    const ids = new Map<string, ResourceId>()

    for (const resource of episode.resources) {
      ids.set(
        resourceKey(resource),
        this.resources.upsert(
          resource,
          resource.lastSeenAtMs,
        ),
      )
    }

    const lastStrongResourceId =
      episode.lastStrongResource
        ? ids.get(
            resourceKey(
              episode.lastStrongResource,
            ),
          )
        : undefined
    const timestamp = this.now()

    this.episodes.replace({
      id: episode.id,
      startedAtMs: episode.startedAtMs,
      endedAtMs: episode.endedAtMs,
      startReason: episode.boundary.startReason,
      endReason:
        episode.boundary.endReason ?? 'timeout',
      ...(episode.workspace
        ? { workspace: episode.workspace }
        : {}),
      ...(episode.threadKey
        ? { threadKey: episode.threadKey }
        : {}),
      ...(lastStrongResourceId
        ? { lastStrongResourceId }
        : {}),
      summaryKind: episode.summaryKind,
      summary: episode.summary,
      confidence: episode.confidence,
      state: episode.state,
      createdAtMs: timestamp,
      updatedAtMs: timestamp,
      expiresAtMs:
        timestamp + EPISODE_RETENTION_MS,
      observationIds: episode.observationIds,
      resources: episode.resources.map(
        resource => {
          const resourceId = ids.get(
            resourceKey(resource),
          )
          if (!resourceId) {
            throw new Error(
              `missing resource id for episode ${episode.id}`,
            )
          }

          return {
            resourceId,
            firstSeenAtMs:
              resource.firstSeenAtMs,
            lastSeenAtMs:
              resource.lastSeenAtMs,
            observationCount:
              resource.observationCount,
          }
        },
      ),
      surfaces: episode.surfaces,
    }, {
      provenance: 'append',
    })
  }
}
