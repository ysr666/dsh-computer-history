import type { DatabaseSync } from 'node:sqlite'
import type { DeleteHistoryResult } from '../../shared/index.js'
import { DeletionService } from './deletion.js'

export interface RetentionSweepResult {
  readonly observations: DeleteHistoryResult
  readonly episodesDeleted: number
}

export class RetentionService {
  private readonly deletion: DeletionService

  public constructor(private readonly db: DatabaseSync) {
    this.deletion = new DeletionService(db)
  }

  public sweep(nowMs = Date.now()): RetentionSweepResult {
    const observations = this.deletion.deleteExpiredObservations(nowMs)

    if (this.db.isTransaction) {
      throw new Error('retention episode cleanup requires transaction ownership')
    }

    this.db.exec('BEGIN IMMEDIATE')
    try {
      const episodesDeleted = Number(
        this.db.prepare(`
          DELETE FROM episodes
          WHERE expires_at_ms IS NOT NULL
            AND expires_at_ms <= ?
        `).run(nowMs).changes,
      )

      this.deletion.cleanupOrphanResources()
      this.db.exec('COMMIT')

      return {
        observations,
        episodesDeleted,
      }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
