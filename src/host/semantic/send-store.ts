import type { DatabaseSync } from 'node:sqlite'

/** One request that left the machine (ADR 0010), with no content in it. */
export interface RemoteSend {
  readonly id: number
  readonly episodeId?: string | undefined
  readonly scopeKey: string
  readonly endpointHost: string
  readonly model: string
  readonly payloadDigest: string
  readonly sentAtMs: number
}

export interface RemoteSendInput {
  readonly scopeKey: string
  readonly endpointHost: string
  readonly model: string
  readonly payloadDigest: string
  readonly sentAtMs: number
  readonly episodeId?: string | undefined
}

/**
 * The audit trail for remote summaries. It records that a request happened and
 * where it went; it does **not** record what it said, because the payload is
 * minimised and reproducible from the episode, and keeping a copy here would be
 * a second place the data lives.
 */
export class RemoteSendStore {
  public constructor(private readonly db: DatabaseSync) {}

  public record(input: RemoteSendInput): number {
    const result = this.db.prepare(`
      INSERT INTO remote_summary_sends(
        episode_id, scope_key, endpoint_host, model, payload_digest, sent_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.episodeId ?? null,
      input.scopeKey,
      input.endpointHost,
      input.model,
      input.payloadDigest,
      input.sentAtMs,
    )
    return Number(result.lastInsertRowid)
  }

  public listForScope(scopeKey: string, limit = 50): readonly RemoteSend[] {
    return (
      this.db.prepare(`
        SELECT id, episode_id, scope_key, endpoint_host, model, payload_digest,
          sent_at_ms
        FROM remote_summary_sends
        WHERE scope_key = ?
        ORDER BY sent_at_ms DESC, id DESC
        LIMIT ?
      `).all(scopeKey, limit) as Array<Record<string, unknown>>
    ).map((row): RemoteSend => ({
      id: Number(row.id),
      // Undefined, not absent: deleting an episode keeps the audit fact and
      // drops only the link, and one object literal keeps lint quiet.
      episodeId: row.episode_id === null ? undefined : String(row.episode_id),
      scopeKey: String(row.scope_key),
      endpointHost: String(row.endpoint_host),
      model: String(row.model),
      payloadDigest: String(row.payload_digest),
      sentAtMs: Number(row.sent_at_ms),
    }))
  }

  /**
   * Revoking an opt-in is an instruction to forget: the local record of what was
   * sent goes too. The remote side cannot be recalled, and the panel says so.
   */
  public deleteForScope(scopeKey: string): number {
    return Number(
      this.db.prepare('DELETE FROM remote_summary_sends WHERE scope_key = ?')
        .run(scopeKey).changes,
    )
  }
}
