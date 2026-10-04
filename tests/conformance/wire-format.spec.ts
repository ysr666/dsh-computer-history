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
    expect(lines.length).toBeGreaterThanOrEqual(6)
    expect(messages.map(message => message.type)).toEqual([
      'hello',
      'configured',
      'state',
      'state',
      'diagnostic',
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
    // No reason means no such key - not null, not empty.
    for (const message of observations.filter(candidate => !candidate.privacy.protected)) {
      expect('reason' in message.privacy).toBe(false)
    }
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
    expect(rows).toHaveLength(2)
    expect(rows.every(row => row.app.bundleId === 'Code.exe')).toBe(true)
    // The control character survives the encoder, the parser and normalisation: it used to arrive as a
    // space, which silently changed what was stored.
    expect(rows.some(row => row.surface.title === 'a\u0007b')).toBe(true)
  })
})
