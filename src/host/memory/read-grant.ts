import { createHash, randomBytes } from 'node:crypto'

const TEN_MINUTES = 10 * 60_000

interface Entry {
  readonly noteId: string
  readonly contentDigest: string
  readonly expiresAtMs: number
}

/**
 * In-memory, one-use capability issued ONLY after a local UI acknowledgement.
 * Neither token nor grant is persisted or available through history search.
 */
export class MemoryReadGrants {
  private readonly entries = new Map<string, Entry>()

  public issue(noteId: string, contentDigest: string, nowMs: number):
  { readonly code: string; readonly expiresAtMs: number } {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMs <= nowMs || entry.noteId === noteId) {
        this.entries.delete(key)
      }
    }
    if (this.entries.size >= 256) throw new Error('too many pending note read grants')
    const code = randomBytes(24).toString('base64url')
    this.entries.set(createHash('sha256').update(code).digest('hex'), {
      noteId, contentDigest, expiresAtMs: nowMs + TEN_MINUTES,
    })
    return { code, expiresAtMs: nowMs + TEN_MINUTES }
  }

  public revoke(code: string): boolean {
    if (!/^[a-zA-Z0-9_-]{32}$/.test(code)) return false
    return this.entries.delete(createHash('sha256').update(code).digest('hex'))
  }

  public consume(code: string, nowMs: number):
  { readonly noteId: string; readonly contentDigest: string } | undefined {
    if (!/^[a-zA-Z0-9_-]{32}$/.test(code)) return undefined
    const key = createHash('sha256').update(code).digest('hex')
    const entry = this.entries.get(key)
    this.entries.delete(key)
    if (!entry || entry.expiresAtMs <= nowMs) return undefined
    return { noteId: entry.noteId, contentDigest: entry.contentDigest }
  }
}
