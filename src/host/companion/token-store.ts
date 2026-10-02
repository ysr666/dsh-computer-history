import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

const TOKEN_BYTES = 32

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Constant-time comparison of two hex digests. Length is compared first
 * because `timingSafeEqual` throws on differing lengths, and a differing
 * length is not a secret once one side is a fixed-size digest.
 */
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

/**
 * The companion pairing token (ADR 0007): 256 bits of randomness, stored as a
 * SHA-256 digest, verifiable in constant time, rotatable by the user.
 */
export class CompanionTokenStore {
  public constructor(private readonly db: DatabaseSync) {}

  /**
   * Create a token, replacing any previous one. Returns the token itself, the
   * only moment it exists outside the extension.
   */
  public rotate(nowMs: number): string {
    const token = randomBytes(TOKEN_BYTES).toString('base64url')
    this.db.prepare(`
      INSERT INTO companion_pairing(id, token_hash, created_at_ms)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        token_hash = excluded.token_hash,
        created_at_ms = excluded.created_at_ms
    `).run(hashToken(token), nowMs)
    return token
  }

  public verify(candidate: string | undefined): boolean {
    if (!candidate || candidate.length === 0) return false
    const row = this.db.prepare(`
      SELECT token_hash FROM companion_pairing WHERE id = 1
    `).get() as { token_hash: string } | undefined
    if (!row) return false
    return sameDigest(hashToken(candidate), row.token_hash)
  }

  public state(): PairingState {
    const row = this.db.prepare(`
      SELECT token_hash, created_at_ms
      FROM companion_pairing
      WHERE id = 1
    `).get() as { token_hash: string; created_at_ms: number } | undefined
    if (!row) return { paired: false }
    return { paired: true, createdAtMs: Number(row.created_at_ms) }
  }
}
