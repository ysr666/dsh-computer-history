import { describe, expect, it } from 'vitest'
import { pairingFromHash } from '../../extension/lib.js'

// One-click pairing: the panel opens the options page with the token in the URL fragment. The parser is the only
// new logic, so it is the thing worth pinning down - including the cases that must NOT be accepted, because a
// pairing token that installs wrongly looks exactly like one that worked.
describe('pairingFromHash', () => {
  const token = 'a'.repeat(32)

  it('reads a token and a port from the fragment', () => {
    expect(pairingFromHash(`#token=${token}&port=19388`)).toEqual({ token, port: 19388 })
  })

  it('reads a token without a port', () => {
    expect(pairingFromHash(`#token=${token}`)).toEqual({ token })
  })

  it('accepts the fragment with or without the leading #', () => {
    expect(pairingFromHash(`token=${token}`)).toEqual({ token })
  })

  it('ignores an empty or missing hash', () => {
    expect(pairingFromHash('')).toEqual({})
    expect(pairingFromHash('#')).toEqual({})
    expect(pairingFromHash('#port=19388')).toEqual({ port: 19388 })
  })

  it('refuses a token shorter than 32 characters', () => {
    expect(pairingFromHash('#token=short')).toEqual({})
  })

  it('refuses a port outside the valid range', () => {
    expect(pairingFromHash(`#token=${token}&port=0`)).toEqual({ token })
    expect(pairingFromHash(`#token=${token}&port=70000`)).toEqual({ token })
    expect(pairingFromHash(`#token=${token}&port=abc`)).toEqual({ token })
  })
})
