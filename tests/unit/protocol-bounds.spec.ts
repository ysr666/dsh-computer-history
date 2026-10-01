import { describe, expect, it } from 'vitest'
import { parseCollectorLine } from '../../src/host/collector/index.js'

function observation(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    type: 'observation',
    collectorSession: 's1',
    seq: 1,
    observedAtMs: 1,
    app: {
      pid: 1,
      bundleId: 'com.microsoft.VSCode',
    },
    privacy: {
      secure: false,
      protected: false,
    },
    source: { adapter: 'vscode' },
    ...overrides,
  }
}

describe('collector field bounds', () => {
  it('rejects oversized bounded metadata fields', () => {
    expect(() => parseCollectorLine(JSON.stringify(
      observation({
        app: { pid: 1, bundleId: 'x'.repeat(513) },
      }),
    ))).toThrow(/exceeds 512 bytes/)

    expect(() => parseCollectorLine(JSON.stringify(
      observation({
        window: { title: 'x'.repeat(4_097) },
      }),
    ))).toThrow(/exceeds 4096 bytes/)
  })
})
