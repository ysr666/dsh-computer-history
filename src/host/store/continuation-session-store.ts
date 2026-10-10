import type { DatabaseSync } from 'node:sqlite'
import type {
  BindContinuationSessionRequest,
  EpisodeId,
} from '../../shared/index.js'

export class ContinuationSessionStore {
  public constructor(private readonly db: DatabaseSync) {}

  public bind(
    request: BindContinuationSessionRequest,
    boundAtMs: number,
    expiresAtMs: number,
  ): void {
    this.db.prepare(`
      INSERT INTO continuation_sessions(
        session_id, episode_id, bound_at_ms, expires_at_ms
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        episode_id = excluded.episode_id,
        bound_at_ms = excluded.bound_at_ms,
        expires_at_ms = excluded.expires_at_ms
    `).run(
      request.sessionId,
      request.episodeId,
      boundAtMs,
      expiresAtMs,
    )
  }

  public episodeForSession(
    sessionId: string,
    nowMs: number,
  ): EpisodeId | undefined {
    const row = this.db.prepare(`
      SELECT binding.episode_id
      FROM continuation_sessions AS binding
      JOIN episodes AS episode ON episode.id = binding.episode_id
      WHERE binding.session_id = ?
        AND binding.expires_at_ms > ?
        AND episode.state != 'invalidated'
        AND (episode.expires_at_ms IS NULL OR episode.expires_at_ms > ?)
    `).get(sessionId, nowMs, nowMs) as { episode_id?: unknown } | undefined
    return typeof row?.episode_id === 'string'
      ? row.episode_id as EpisodeId
      : undefined
  }

  /** A live Session binding exists but its source Episode may no longer be retained.
   * Never expose its Episode id through this diagnostic-only predicate. */
  public hasLiveBinding(sessionId: string, nowMs: number): boolean {
    return this.db.prepare(
      'SELECT 1 FROM continuation_sessions WHERE session_id = ? AND expires_at_ms > ?',
    ).get(sessionId, nowMs) !== undefined
  }

  public deleteSession(sessionId: string): boolean {
    return Number(this.db.prepare(
      'DELETE FROM continuation_sessions WHERE session_id = ?',
    ).run(sessionId).changes) > 0
  }

  public deleteExpired(nowMs: number): number {
    return Number(this.db.prepare(
      'DELETE FROM continuation_sessions WHERE expires_at_ms <= ?',
    ).run(nowMs).changes)
  }
}
