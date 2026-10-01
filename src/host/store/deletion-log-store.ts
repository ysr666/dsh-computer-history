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

  public blocksObservation(input: {
    readonly observedAtMs: number
    readonly bundleId: string
  }): boolean {
    return this.db.prepare(`
      SELECT 1 AS blocked
      FROM deletion_log
      WHERE requested_at_ms >= ?
        AND (
          scope = 'all'
          OR (
            scope = 'episode'
            AND range_start_ms <= ?
            AND range_end_ms > ?
          )
          OR (
            scope = 'app'
            AND bundle_id = ?
          )
          OR (
            scope = 'time-range'
            AND range_start_ms <= ?
            AND range_end_ms > ?
          )
        )
      LIMIT 1
    `).get(
      input.observedAtMs,
      input.observedAtMs,
      input.observedAtMs,
      input.bundleId,
      input.observedAtMs,
      input.observedAtMs,
    ) !== undefined
  }

  public deleteOlderThan(cutoffMs: number): number {
    return Number(
      this.db.prepare(`
        DELETE FROM deletion_log
        WHERE requested_at_ms < ?
      `).run(cutoffMs).changes,
    )
  }

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
