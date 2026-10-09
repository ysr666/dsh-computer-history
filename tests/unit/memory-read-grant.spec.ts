import { describe, expect, it } from 'vitest'
import { MemoryReadGrants } from '../../src/host/memory/read-grant.js'

describe('one-time AI note read grants', () => {
  it('issues a unique 192-bit capability and uses it only once', () => {
    const grants = new MemoryReadGrants()
    const first = grants.issue('note-a', 'hash1', 1000)
    expect(first.code).toMatch(/^[a-zA-Z0-9_-]{32}$/)
    expect(first.expiresAtMs).toBe(601000)
    expect(grants.consume(first.code, 1010)).toEqual({
      noteId: 'note-a', contentDigest: 'hash1',
    })
    expect(grants.consume(first.code, 1011)).toBeUndefined()
    const next = grants.issue('note-a', 'hash1', 1020)
    expect(next.code).not.toBe(first.code)
  })

  it('expires codes exactly after ten minutes and rejects malformed input', () => {
    const grants = new MemoryReadGrants()
    const issue = grants.issue('n', 'hash', 100)
    expect(grants.consume(issue.code, 600100)).toBeUndefined()
    expect(grants.consume('invalid', 10)).toBeUndefined()
  })

  it('revokes only the specified pending code', () => {
    const grants = new MemoryReadGrants()
    const a = grants.issue('a', 'h1', 100)
    const b = grants.issue('b', 'h2', 100)
    expect(grants.revoke(a.code)).toBe(true)
    expect(grants.revoke(a.code)).toBe(false)
    expect(grants.consume(a.code, 200)).toBeUndefined()
    expect(grants.consume(b.code, 200)).toMatchObject({ noteId: 'b' })
  })

  it('a new code for the same note invalidates the prior one', () => {
    const grants = new MemoryReadGrants()
    const a = grants.issue('a', 'h1', 100)
    const b = grants.issue('a', 'h2', 101)
    expect(grants.consume(a.code, 105)).toBeUndefined()
    expect(grants.consume(b.code, 105)).toMatchObject({ contentDigest: 'h2' })
  })
})
