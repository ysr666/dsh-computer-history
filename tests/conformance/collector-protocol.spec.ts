import { describe, expect, it } from 'vitest'
import { parseCollectorLine } from '../../src/host/collector/protocol.js'

/**
 * What the collector protocol actually enforces, measured rather than assumed.
 *
 * The first version of docs/collector-protocol.md claimed that unknown fields are refused. They are not:
 * feeding an observation with an extra field is accepted and the extra key is silently dropped, while an
 * unknown *message type* is refused. The difference matters for the three-platform contract - "silently
 * dropped" means a collector's mistake is invisible, which is the opposite of a boundary a parser
 * enforces - so it is recorded here as today's behaviour and as a deliberate gap, not as a guarantee.
 */
const observation = (extra: Record<string, unknown> = {}): string => JSON.stringify({
  v: 1,
  type: 'observation',
  collectorSession: 's1',
  seq: 1,
  observedAtMs: 1_000,
  app: { pid: 1, bundleId: 'com.microsoft.VSCode' },
  privacy: { secure: false, protected: false },
  source: { adapter: 'vscode' },
  ...extra,
})

describe('collector protocol conformance: what is enforced today', () => {
  it('accepts a well-formed observation', () => {
    expect((parseCollectorLine(observation()) as { type: string }).type).toBe('observation')
  })

  it('drops an unknown field instead of refusing it - recorded, not endorsed', () => {
    const parsed = parseCollectorLine(observation({ documentText: 'secret' })) as unknown as Record<string, unknown>
    expect(parsed.type).toBe('observation')
    // The field is not carried anywhere: whatever a collector invents cannot reach storage.
    expect(Object.keys(parsed)).not.toContain('documentText')
  })

  it('refuses an unknown message type', () => {
    expect(() => parseCollectorLine(JSON.stringify({ v: 1, type: 'nonsense' })))
      .toThrowError(/unknown collector message type/)
  })

  it('refuses a line that is not JSON at all', () => {
    expect(() => parseCollectorLine('not json')).toThrowError(/invalid JSON/)
  })

  it('carries a protected observation to the caller, which decides what to do with it', () => {
    const parsed = parseCollectorLine(observation({
      privacy: { secure: false, protected: true, reason: 'protected-app' },
    })) as { privacy: { protected: boolean } }
    // The parser reports; ingestion drops. Conflating the two would make the refusal uncountable.
    expect(parsed.privacy.protected).toBe(true)
  })
})
