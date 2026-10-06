import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCollectorLine } from '../../src/host/collector/protocol.js'
import {
  normalizeObservation,
  type RefusalReport,
} from '../../src/host/ingestion/index.js'
import {
  PolicyRuleId,
  type PolicySnapshot,
} from '../../src/shared/index.js'

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

  it('preserves native collector provenance but never lets collector wire impersonate a companion', () => {
    const parsed = parseCollectorLine(observation({
      source: { adapter: 'vscode', provider: 'windows-uia' },
    }))
    expect(parsed.type).toBe('observation')
    if (parsed.type === 'observation') {
      expect(parsed.source.provider).toBe('windows-uia')
    }
    expect(() => parseCollectorLine(observation({
      source: { adapter: 'vscode', provider: 'companion' },
    }))).toThrowError(/unsupported collector observation provider/)
    expect(() => parseCollectorLine(observation({
      source: { adapter: 'vscode', provider: 'invented' },
    }))).toThrowError(/unsupported collector observation provider/)
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

  it('ingests the live Windows transcript of 2026-10-04', () => {
    // These are the bytes off a real machine (Windows 11 26200, collector 0.1.0, exe sha256
    // 7f1f565d08ba416bbc6bb6c5a086ce1166fda57d6f27de2494b1bb8951889a3d): three runs, five
    // observations - explorer.exe three times, WindowsTerminal.exe once, and a policy-protected
    // Notepad.exe once. Keeping them as a fixture means the measurements they carry ("the terminal
    // title never reaches storage", "a protected application is counted by its own reason") stay
    // checked against the parser and the ingestion path instead of living only in a document.
    const lines = readFileSync(
      new URL(
        './fixtures/live-windows-2026-10-04.jsonl',
        import.meta.url,
      ),
      'utf8',
    ).trim().split('\n')
    const parsed = lines.map(line => parseCollectorLine(line))

    const hellos = parsed.filter(message => message.type === 'hello')
    expect(hellos).toHaveLength(3)
    for (const hello of hellos) {
      expect(hello.platform).toBe('win32')
      expect(hello.arch).toBe('x64')
    }
    const observations = parsed.filter(
      message => message.type === 'observation',
    )
    expect(observations).toHaveLength(5)

    const policy: PolicySnapshot = {
      revision: 1,
      mode: 'include-only',
      rules: ['explorer.exe', 'WindowsTerminal.exe'].map((pattern, index) => ({
        id: PolicyRuleId(`live-windows-${index}`),
        dimension: 'app',
        action: 'allow',
        matcher: 'exact',
        pattern,
        builtIn: false,
        createdAtMs: 1,
        updatedAtMs: 1,
      })),
      updatedAtMs: 1,
    }

    const rows = []
    const refusals: string[] = []
    for (const message of observations) {
      const refusal: RefusalReport = {}
      const row = normalizeObservation(
        message,
        policy,
        message.observedAtMs,
        undefined,
        undefined,
        undefined,
        refusal,
      )
      if (row) rows.push(row)
      else refusals.push(refusal.reason ?? 'unknown')
    }

    // Explorer maps to the file manager's window surface, with its title recorded...
    expect(rows.map(row => row.surface.kind).toSorted())
      .toEqual(['terminal', 'window', 'window', 'window'])
    expect(
      rows.filter(row => row.app.bundleId === 'explorer.exe')
        .every(row => row.surface.title === '47209 - 文件资源管理器'),
    ).toBe(true)
    // ...while the terminal's title is suppressed before it can be stored (it carries the working
    // directory and the running command), and the protected application stores nothing at all.
    const terminal = rows.find(row => row.surface.kind === 'terminal')
    expect(terminal?.app.bundleId).toBe('WindowsTerminal.exe')
    expect(terminal?.surface.title).toBeUndefined()
    expect(refusals).toEqual(['protected-app'])
  })
})
