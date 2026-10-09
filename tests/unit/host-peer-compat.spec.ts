import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { satisfies } from 'semver'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  peerDependencies: Record<string, string>
}
const peers = pkg.peerDependencies
const hostPeers = Object.entries(peers)
  .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))

describe('explicitly supported DSH Host versions', () => {
  it('keeps every Host peer compatible with the released RC2 baseline', () => {
    expect(hostPeers.length).toBeGreaterThan(20)
    for (const [, range] of hostPeers) {
      expect(satisfies('0.2.0-rc.2', range)).toBe(true)
    }
    expect(satisfies('4.0.4', peers['@deepseek-ai/cordis']!)).toBe(true)
  })

  it('accepts only the precisely tested Alpha 2 prerelease and Cordis', () => {
    for (const [, range] of hostPeers) {
      expect(satisfies('0.2.1-alpha.2', range)).toBe(true)
      expect(satisfies('0.2.1-alpha.1', range)).toBe(false)
      expect(satisfies('0.2.1-alpha.3', range)).toBe(false)
      expect(satisfies('0.3.0', range)).toBe(false)
    }
    expect(satisfies('4.0.5-alpha.1', peers['@deepseek-ai/cordis']!)).toBe(true)
    expect(satisfies('4.0.5-alpha.2', peers['@deepseek-ai/cordis']!)).toBe(false)
  })

  it('rejects prerelease versions of other untested Host lines', () => {
    for (const [, range] of hostPeers) {
      expect(satisfies('0.2.2-alpha.1', range)).toBe(false)
      expect(satisfies('0.3.0-alpha.1', range)).toBe(false)
    }
  })
})
