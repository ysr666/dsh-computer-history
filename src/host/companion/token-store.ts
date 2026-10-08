import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CompanionKind } from '../../shared/index.js'

const TOKEN_BYTES = 32

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function sameDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export interface PairingState {
  readonly paired: boolean
  readonly createdAtMs?: number
}

type Credential = {
  readonly tokenHash: string
  readonly createdAtMs: number
}

export interface CompanionPairingCheckpoint {
  readonly credential?: {
    readonly tokenHash: string
    readonly createdAtMs: number
  }
}

/**
 * Per-companion pairing credentials (ADR 0007 / ADR 0009).
 *
 * Browser and editor credentials are independent so rotating one cannot silently
 * disconnect the other. Only SHA-256 digests persist in SQLite. The current
 * digests are mirrored in memory for cheap verification. Because the database is
 * shared by multiple DSH Hosts, the cache watches SQLite `data_version` and reloads
 * when another connection changes pairing. Companion intake is stopped before
 * SQLite closes, so this refresh cannot outlive the database lifecycle.
 */
export class CompanionTokenStore {
  private readonly credentials = new Map<CompanionKind, Credential>()
  private observedDataVersion = 0

  public constructor(private readonly db: DatabaseSync) {
    this.reloadCredentials()
  }

  private dataVersion(): number {
    const row = this.db.prepare('PRAGMA data_version').get() as {
      data_version?: number | bigint
    }
    return Number(row.data_version ?? 0)
  }

  private reloadCredentials(): void {
    // If a second Host rotates between the SELECT and PRAGMA data_version,
    // caching the earlier rows with the newer version would keep a revoked
    // credential valid indefinitely. Apply only one stable committed snapshot.
    // Repeated contention fails closed rather than spinning during auth checks.
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = this.dataVersion()
      const rows = this.db.prepare(`
        SELECT kind, token_hash, created_at_ms
        FROM companion_pairing
      `).all() as Array<{
        kind: CompanionKind
        token_hash: string
        created_at_ms: number
      }>
      const after = this.dataVersion()
      if (before !== after) continue

      this.credentials.clear()
      for (const row of rows) {
        if (row.kind !== 'browser' && row.kind !== 'editor') continue
        this.credentials.set(row.kind, {
          tokenHash: row.token_hash,
          createdAtMs: Number(row.created_at_ms),
        })
      }
      this.observedDataVersion = after
      return
    }
    throw new Error('companion pairing changed during every snapshot read')
  }

  private refreshExternalChanges(): void {
    const version = this.dataVersion()
    if (version === this.observedDataVersion) return
    this.reloadCredentials()
  }

  /**
   * Snapshot one credential so a larger cross-resource operation can compensate
   * if publishing the cleartext handoff fails after rotation.
   */
  public checkpoint(kind: CompanionKind): CompanionPairingCheckpoint {
    this.refreshExternalChanges()
    const credential = this.credentials.get(kind)
    return credential
      ? { credential: { ...credential } }
      : {}
  }

  /**
   * Restore a checkpoint only if the durable credential is still the token
   * produced by the rotation being compensated. Another Host may legitimately
   * rotate the same companion while filesystem publication is in progress;
   * an unconditional rollback would erase that newer successful write.
   *
   * Returns false when a later writer won. In that case the local cache is
   * refreshed from SQLite and the newer credential is preserved.
   */
  public restore(
    kind: CompanionKind,
    checkpoint: CompanionPairingCheckpoint,
    expectedCurrentToken: string,
  ): boolean {
    const expectedHash = hashToken(expectedCurrentToken)
    const credential = checkpoint.credential
    const result = credential
      ? this.db.prepare(`
          UPDATE companion_pairing
          SET token_hash = ?, created_at_ms = ?
          WHERE kind = ? AND token_hash = ?
        `).run(
          credential.tokenHash,
          credential.createdAtMs,
          kind,
          expectedHash,
        )
      : this.db.prepare(
          'DELETE FROM companion_pairing WHERE kind = ? AND token_hash = ?',
        ).run(kind, expectedHash)

    if (Number(result.changes) === 1) {
      if (credential) this.credentials.set(kind, { ...credential })
      else this.credentials.delete(kind)
      return true
    }

    // A different writer replaced our token after rotate(). Reflect that
    // durable winner locally instead of restoring a stale checkpoint.
    this.reloadCredentials()
    return false
  }

  /** Create a credential for one companion kind, replacing only that kind. */
  public rotate(kind: CompanionKind, nowMs: number): string {
    const token = randomBytes(TOKEN_BYTES).toString('base64url')
    const tokenHash = hashToken(token)
    this.db.prepare(`
      INSERT INTO companion_pairing(kind, token_hash, created_at_ms)
      VALUES (?, ?, ?)
      ON CONFLICT(kind) DO UPDATE SET
        token_hash = excluded.token_hash,
        created_at_ms = excluded.created_at_ms
    `).run(kind, tokenHash, nowMs)
    this.credentials.set(kind, { tokenHash, createdAtMs: nowMs })
    return token
  }

  public verify(kind: CompanionKind, candidate: string | undefined): boolean {
    if (!candidate || candidate.length === 0) return false
    this.refreshExternalChanges()
    const credential = this.credentials.get(kind)
    if (!credential) return false
    return sameDigest(hashToken(candidate), credential.tokenHash)
  }

  public state(kind: CompanionKind): PairingState {
    this.refreshExternalChanges()
    const credential = this.credentials.get(kind)
    if (!credential) return { paired: false }
    return { paired: true, createdAtMs: credential.createdAtMs }
  }
}
