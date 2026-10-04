import { spawnSync } from 'node:child_process'
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
 * The boundary no language can check about itself: the Rust collectors' serialiser and this Host's parser.
 *
 * It has broken once - a doubled `reason` key made an observation line invalid JSON and the manager
 * stopped the collector - and the hand-written encoder that produced it also turned control characters
 * into spaces. Both were encoder bugs, which is why the encoder is now serde and why this test feeds
 * **generated** output (not a recorded fixture) through the real parser and the real normaliser.
 *
 * `wire-baseline` prints one line of every message a collector can emit and is deterministic: fixed
 * session, clock, pid and sequence numbers. Its observation lines cover a normal editor, a protected
 * application, and a title carrying `\u0007`.
 */
const CARGO_TIMEOUT_MS = 120_000
const cargoAvailable = spawnSync('cargo', ['--version'], { encoding: 'utf8' }).status === 0

function exampleOutput(): string {
  const run = spawnSync(
    'cargo',
    [
      'run',
      '--quiet',
      '--manifest-path',
      'native/collector-protocol/Cargo.toml',
      '--example',
      'wire-baseline',
    ],
    { encoding: 'utf8', timeout: CARGO_TIMEOUT_MS },
  )
  if (run.status !== 0) {
    throw new Error(`cargo run --example wire-baseline failed: ${run.stderr}`)
  }
  return run.stdout
}

const lines = cargoAvailable
  ? exampleOutput().trim().split('\n').filter(line => line.length > 0)
  : []
const messages = lines.map(line => parseCollectorLine(line))
const observations = messages.filter(message => message.type === 'observation')

describe('the collector wire format, against the real Host parser', () => {
  it.skipIf(!cargoAvailable)('parses every generated line, in the documented order', () => {
    expect(lines.length).toBe(10)
    expect(messages.map(message => message.type)).toEqual([
      'hello',
      'configured',
      'state',
      'state',
      'diagnostic',
      'observation',
      'observation',
      'observation',
      'observation',
      'observation',
    ])
    // The arch vocabulary is the host's: a collector whose word is rejected dies on this line, which is
    // what happened to the first Windows build.
    const hello = messages.find(message => message.type === 'hello')
    expect(hello).toMatchObject({ type: 'hello', platform: 'win32' })
    if (hello?.type !== 'hello') throw new Error('no hello line in the generated output')
    expect(['arm64', 'x64', 'x86']).toContain(hello.arch)
  })

  it.skipIf(!cargoAvailable)('keeps the refusal reason and the absent-key rule across the wire', () => {
    const protectedObservation = observations.filter(
      message => message.privacy.protected,
    )
    expect(protectedObservation).toHaveLength(1)
    // The host counts refusals by this string; a doubled key or a mangled one stops capture.
    expect(protectedObservation[0]?.privacy.reason).toBe('protected-app')
    // No reason means no such key - not null, not empty. This has to be asserted on the **wire text**:
    // the Host parser maps null to undefined (`optionalString`), so a regression that emitted
    // `"reason":null` would look identical after parsing. An adversarial re-run proved that gap by
    // mutating the wire and watching the parsed-value assertion pass.
    const observationLines = lines.filter(line => line.includes('"type":"observation"'))
    expect(observationLines).toHaveLength(5)
    expect(observationLines.filter(line => line.includes('"reason":'))).toHaveLength(1)
    expect(observationLines.some(line => line.includes('"reason":null'))).toBe(false)
  })

  it.skipIf(!cargoAvailable)('normalises to one refusal and two stored surfaces', () => {
    const policy: PolicySnapshot = {
      revision: 1,
      mode: 'include-only',
      rules: ['Code.exe', 'notepad.exe'].map((pattern, index) => ({
        id: PolicyRuleId(`wire-format-${index}`),
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

    expect(refusals).toEqual(['protected-app'])
    expect(rows).toHaveLength(4)
    expect(rows.every(row => row.app.bundleId === 'Code.exe')).toBe(true)
    // The control characters survive the encoder, the parser and normalisation: they used to arrive as a
    // space, and the two spellings of 0x08/0x0C must decode to the same characters the example put in.
    const titles = rows.map(row => row.surface.title).filter(Boolean)
    expect(titles).toContain('a\u0007b')
    expect(titles).toContain('c\u0008d')
    expect(titles).toContain('e\u000cf')
  })
})
