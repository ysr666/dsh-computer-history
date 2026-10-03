import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PHASE1_ADAPTERS } from '../../src/shared/constants.js'

/**
 * The cross-platform contract, as data.
 *
 * A collector qualifies on facts that do not depend on its platform: which adapter an application maps
 * to, what surface that adapter has, what kind of resource it produces and whether its title is
 * recorded. The ids differ per platform and mapping them is the collector's job - which is exactly what
 * a Windows or Linux collector will have to show, against the same expectations.
 */
interface AdapterFixture {
  readonly adapter: string
  readonly ids: Readonly<Record<string, readonly string[]>>
  readonly expect: {
    readonly surfaceKind: string
    readonly titleRecorded: boolean
  }
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/adapters.json', import.meta.url), 'utf8'),
) as { adapters: readonly AdapterFixture[]; refusals: readonly { case: string; reason: string }[] }

describe('the cross-platform adapter contract', () => {
  it('names adapters this build actually has', () => {
    const known = new Set(PHASE1_ADAPTERS.map(adapter => adapter.id))
    for (const entry of fixture.adapters) {
      expect(known.has(entry.adapter as never)).toBe(true)
    }
  })

  it('agrees with the adapter table on the surface it declares', () => {
    // Only the surface kind, on purpose: the resource kind is the adapter table's own data, and the
    // first version of this fixture restated it - wrongly - which made two sources of truth that can
    // drift. What a collector must reproduce is the platform-independent fact, not a copy of the table.
    for (const entry of fixture.adapters) {
      const adapter = PHASE1_ADAPTERS.find(item => item.id === entry.adapter)
      expect(adapter).toBeDefined()
      expect(entry.expect.surfaceKind).toBe(adapter?.surfaceKind)
    }
  })

  it('carries this platform\u2019s ids for every adapter it claims to cover', () => {
    const known = new Set(PHASE1_ADAPTERS.flatMap(adapter => [...adapter.bundleIds]))
    for (const entry of fixture.adapters) {
      const darwin = entry.ids.darwin ?? []
      expect(darwin.length).toBeGreaterThan(0)
      for (const id of darwin) expect(known.has(id)).toBe(true)
    }
  })

  it('expects a title to be suppressed only where the table suppresses it', () => {
    const terminal = fixture.adapters.find(entry => entry.adapter === 'terminal')
    expect(terminal?.expect.titleRecorded).toBe(false)
    // Every other adapter records the title it is given.
    for (const entry of fixture.adapters.filter(item => item.adapter !== 'terminal')) {
      expect(entry.expect.titleRecorded).toBe(true)
    }
  })

  it('uses the same refusal reason strings the host counts', () => {
    // The reason strings are part of the contract: a platform that invents its own makes the refusal
    // breakdown incomparable across platforms, which is the one thing the breakdown exists for.
    const reasons = fixture.refusals.map(entry => entry.reason)
    expect(reasons).toEqual(['protected-app', 'secure-field', 'not-an-adapter'])
    expect(new Set(reasons).size).toBe(reasons.length)
  })
})
