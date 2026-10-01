import type { DatabaseSync } from 'node:sqlite'

export type DeletionScope =
  | 'time-range'
  | 'episode'
  | 'app'
  | 'all'

export interface DeletionLogEntry {
  readonly id: string
  readonly requestedAtMs: number
  readonly scope: DeletionScope
  readonly rangeStartMs?: number
  readonly rangeEndMs?: number
  readonly bundleId?: string
  readonly observationsDeleted: number
  readonly episodesDeleted: number
  readonly episodesRebuilt: number
}

export class DeletionLogStore {
  public constructor(private readonly db: DatabaseSync) {}

  public insert(entry: DeletionLogEntry): void {
    this.db.prepare(`
      INSERT INTO deletion_log(
        id,
        requested_at_ms,
        scope,
        range_start_ms,
        range_end_ms,
        bundle_id,
        observations_deleted,
        episodes_deleted,
        episodes_rebuilt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.requestedAtMs,
      entry.scope,
      entry.rangeStartMs ?? null,
      entry.rangeEndMs ?? null,
      entry.bundleId ?? null,
      entry.observationsDeleted,
      entry.episodesDeleted,
      entry.episodesRebuilt,
    )
  }
}
