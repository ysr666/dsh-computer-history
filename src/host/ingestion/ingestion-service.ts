import type { DatabaseSync } from 'node:sqlite'
import {
  EPISODE_RETENTION_MS,
  type NativeObservation,
  type PolicySnapshot,
  type ResourceId,
  type WorkspaceRef,
} from '../../shared/index.js'
import { buildEpisodes } from '../episodes/index.js'
import {
  EpisodeStore,
  ObservationStore,
  ResourceStore,
} from '../store/index.js'
import { normalizeObservation } from './normalize.js'

export interface WorkspaceResolver {
  resolve(resourceUri: string | undefined): Promise<WorkspaceRef>
}

export class IngestionService {
  private readonly observations: ObservationStore
  private readonly resources: ResourceStore
  private readonly episodes: EpisodeStore

  public constructor(
    private readonly db: DatabaseSync,
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly policy: () => PolicySnapshot,
    private readonly now: () => number = Date.now,
  ) {
    this.observations = new ObservationStore(db)
    this.resources = new ResourceStore(db)
    this.episodes = new EpisodeStore(db)
  }

  public async ingest(message: NativeObservation): Promise<boolean> {
    const rawUri = message.window?.document ?? message.window?.url
    const workspace = await this.workspaceResolver.resolve(rawUri)
    const observation = normalizeObservation(
      message,
      this.policy(),
      this.now(),
      workspace,
    )
    if (!observation) return false

    const resourceId = observation.resource
      ? this.resources.upsert(
          observation.resource,
          observation.observedAtMs,
        )
      : undefined

    this.observations.insert(observation, resourceId)
    this.rebuild()
    return true
  }

  private rebuild(): void {
    const built = buildEpisodes(this.observations.listAll())
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.episodes.deleteAll()
      for (const episode of built) {
        const ids = new Map<string, ResourceId>()
        for (const resource of episode.resources) {
          ids.set(
            resource.kind + '\0' + resource.canonicalUri,
            this.resources.upsert(resource, resource.lastSeenAtMs),
          )
        }

        const last = episode.lastStrongResource
          ? ids.get(
              episode.lastStrongResource.kind
              + '\0'
              + episode.lastStrongResource.canonicalUri,
            )
          : undefined

        this.episodes.replace({
          id: episode.id,
          startedAtMs: episode.startedAtMs,
          endedAtMs: episode.endedAtMs,
          startReason: episode.boundary.startReason,
          endReason: episode.boundary.endReason ?? 'timeout',
          ...(episode.workspace ? { workspace: episode.workspace } : {}),
          ...(episode.threadKey ? { threadKey: episode.threadKey } : {}),
          ...(last ? { lastStrongResourceId: last } : {}),
          summaryKind: episode.summaryKind,
          summary: episode.summary,
          confidence: episode.confidence,
          state: episode.state,
          createdAtMs: this.now(),
          updatedAtMs: this.now(),
          expiresAtMs: this.now() + EPISODE_RETENTION_MS,
          observationIds: episode.observationIds,
          resources: episode.resources.map((resource) => ({
            resourceId: ids.get(
              resource.kind + '\0' + resource.canonicalUri,
            )!,
            firstSeenAtMs: resource.firstSeenAtMs,
            lastSeenAtMs: resource.lastSeenAtMs,
            observationCount: resource.observationCount,
          })),
          surfaces: episode.surfaces,
        })
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
