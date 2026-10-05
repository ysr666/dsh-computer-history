import { describe, expect, it } from 'vitest'
import { isProtectedText, isProtectedTitle } from '../../src/host/ingestion/normalize.js'
import type { PolicySnapshot } from '../../src/shared/policy.js'

// The predicates the Host screens metadata with had no test of their own. These cases were found by an
// adversarial pass that asked which files a person would not want their history to name: an SSH private key
// outside `.ssh`, a registry token in `.npmrc`, a cloud service account key. The list was name-based and
// simply did not mention them, so a path or a window title carrying one of those names was stored.

const empty: PolicySnapshot = { revision: 1, mode: 'include-only', updatedAtMs: 1, rules: [] }
const uri = (name: string) => `file:///Users/someone/project/${name}`

describe('sensitive names are screened', () => {
  const mustBeProtected = [
    '.env', '.env.local', '.netrc', '.npmrc', '.git-credentials', 'credentials.json',
    'id_rsa', 'id_ed25519', 'id_ecdsa',
    'service-account.json', 'keystore.jks', 'server.p12', 'server.pem', 'server.key',
    '.ssh/config', 'secrets.yaml',
  ]
  for (const name of mustBeProtected) {
    it(`screens ${name}`, () => {
      expect(isProtectedText(uri(name), empty)).toBe(true)
    })
  }

  // Public keys are public: `id_rsa.pub`, `authorized_keys` and `known_hosts` are not credentials, so
// screening them would be over-blocking. The list names secrets only.
const ordinary = ['notes.txt', 'README.md', 'index.ts', 'main.rs', 'photo.png', 'id_rsa.pub',
  'authorized_keys', 'known_hosts']
  for (const name of ordinary) {
    it(`does not screen ${name}`, () => {
      expect(isProtectedText(uri(name), empty)).toBe(false)
    })
  }

  it('screens a window title that is nothing but a key file name', () => {
    // Editors title a window with just the file name when they have no document to offer, so the title is
    // the only place the name can appear - and a title is content the store keeps.
    expect(isProtectedTitle('id_rsa', empty)).toBe(true)
    expect(isProtectedTitle('.npmrc', empty)).toBe(true)
    expect(isProtectedTitle('notes.txt', empty)).toBe(false)
  })

  it('still screens percent-encoded forms', () => {
    expect(isProtectedText('file:///Users/someone/%2Eenv', empty)).toBe(true)
  })
})
