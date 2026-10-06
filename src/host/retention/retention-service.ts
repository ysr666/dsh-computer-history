import type { DatabaseSync } from 'node:sqlite'
import { RETENTION_BOUNDS } from '../../shared/index.js'
import { DeletionLogStore } from '../store/index.js'
import { DeletionService } from './deletion.js'

const MAX_OBSERVATION_RETENTION_MS =
  RETENTION_BOUNDS.observationRetentionHours.max * 3_600_000

export interface RetentionSweepResult {
  readonly observationsDeleted: number
  readonly episodesDeleted: number
}

export class RetentionService {
  private readonly deletion: DeletionService

  public constructor(private readonly db: DatabaseSync) {
    this.deletion = new DeletionService(db)
  }

  public sweep(nowMs = Date.now()): RetentionSweepResult {
    if (this.db.isTransaction) {
      throw new Error(
        'retention cleanup requires transaction ownership',
      )
    }

    this.db.exec('BEGIN IMMEDIATE')
    try {
      // Raw TTL is evidence compaction, not a user deletion request.
      // episode_observations cascades away, while the independently
      // retained Episode summary/resources survive until their own TTL.
      const observationsDeleted = Number(
        this.db.prepare(`
          DELETE FROM observations
          WHERE expires_at_ms <= ?
        `).run(nowMs).changes,
      )

      const episodesDeleted = Number(
        this.db.prepare(`
          DELETE FROM episodes
          WHERE expires_at_ms IS NOT NULL
            AND expires_at_ms <= ?
        `).run(nowMs).changes,
      )

      // Tombstones must outlive every delayed observation the Host
      // could still accept. Retention is user-configurable up to the shared
      // maximum, and a user may raise it after the deletion; pruning at the
      // 24-hour default would let an older pre-delete observation become valid
      // again and resurrect history. The maximum accepted raw window is the
      // point after which no pre-delete observation can pass normalization.
      new DeletionLogStore(this.db).deleteOlderThan(
        nowMs - MAX_OBSERVATION_RETENTION_MS,
      )
      this.deletion.cleanupOrphanResources()
      this.db.exec('COMMIT')

      return {
        observationsDeleted,
        episodesDeleted,
      }
    } catch (error) {
      if (this.db.isTransaction) {
        this.db.exec('ROLLBACK')
      }
      throw error
    }
  }
}
