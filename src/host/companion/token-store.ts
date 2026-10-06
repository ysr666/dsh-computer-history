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
 * digests are mirrored in memory, with SQLite data_version used to notice a
 * rotation committed by another Host. Plugin teardown stops the loopback intake
 * before the database can close, so this coherence check never outlives SQLite.
 */
export class CompanionTokenStore {
  private readonly credentials = new Map<CompanionKind, Credential>()
  private dataVersion = -1

  public constructor(private readonly db: DatabaseSync) {
    this.reloadCredentials()
  }

  private readDataVersion(): number {
    const row = this.db.prepare('PRAGMA data_version').get() as {
      data_version: number
    }
    return Number(row.data_version)
  }

  private reloadCredentials(): void {
    // A second Host may rotate a credential between the row read and the
    // data_version read. Repeat until both observations describe one stable
    // committed snapshot instead of caching a mixture.
    while (true) {
      const before = this.readDataVersion()
      const rows = this.db.prepare(`
        SELECT kind, token_hash, created_at_ms
        FROM companion_pairing
      `).all() as Array<{
        kind: CompanionKind
        token_hash: string
        created_at_ms: number
      }>
      const after = this.readDataVersion()
      if (before !== after) continue

      this.credentials.clear()
      for (const row of rows) {
        if (row.kind !== 'browser' && row.kind !== 'editor') continue
        this.credentials.set(row.kind, {
          tokenHash: row.token_hash,
          createdAtMs: Number(row.created_at_ms),
        })
      }
      this.dataVersion = after
      return
    }
  }

  private refreshIfChanged(): void {
    if (this.readDataVersion() !== this.dataVersion) {
      this.reloadCredentials()
    }
  }

  /**
   * Snapshot one credential so a larger cross-resource operation can compensate
   * if publishing the cleartext handoff fails after rotation.
   */
  public checkpoint(kind: CompanionKind): CompanionPairingCheckpoint {
    this.refreshIfChanged()
    const credential = this.credentials.get(kind)
    return credential
      ? { credential: { ...credential } }
      : {}
  }

  /**
   * Restore a checkpoint in SQLite first and mirror it in memory only after the
   * durable write succeeds.
   */
  public restore(
    kind: CompanionKind,
    checkpoint: CompanionPairingCheckpoint,
  ): void {
    const credential = checkpoint.credential
    if (credential) {
      this.db.prepare(`
        INSERT INTO companion_pairing(kind, token_hash, created_at_ms)
        VALUES (?, ?, ?)
        ON CONFLICT(kind) DO UPDATE SET
          token_hash = excluded.token_hash,
          created_at_ms = excluded.created_at_ms
      `).run(kind, credential.tokenHash, credential.createdAtMs)
      this.credentials.set(kind, { ...credential })
      return
    }

    this.db.prepare(
      'DELETE FROM companion_pairing WHERE kind = ?',
    ).run(kind)
    this.credentials.delete(kind)
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
    this.refreshIfChanged()
    const credential = this.credentials.get(kind)
    if (!credential) return false
    return sameDigest(hashToken(candidate), credential.tokenHash)
  }

  public state(kind: CompanionKind): PairingState {
    this.refreshIfChanged()
    const credential = this.credentials.get(kind)
    if (!credential) return { paired: false }
    return { paired: true, createdAtMs: credential.createdAtMs }
  }
}
