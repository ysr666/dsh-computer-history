import type { DatabaseSync } from 'node:sqlite'
import { OBSERVATION_RETENTION_MS } from '../../shared/index.js'
import { DeletionLogStore } from '../store/index.js'
import { DeletionService } from './deletion.js'

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

      new DeletionLogStore(this.db).deleteOlderThan(
        nowMs - OBSERVATION_RETENTION_MS,
      )
      this.deletion.cleanupOrphanResources()
      this.db.exec('COMMIT')

      return {
        observationsDeleted,
        episodesDeleted,
      }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
