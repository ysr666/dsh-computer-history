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

/** A hello line with the platform and arch under test. */
function hello(platform: string, arch: string): string {
  return JSON.stringify({
    v: 1,
    type: 'hello',
    collectorSession: 's1',
    collectorVersion: '0.1.0',
    platform,
    arch,
    capabilities: ['app-focus'],
  })
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

  it('accepts the hello platform and arch words the collectors send', () => {
    expect(parseCollectorLine(hello('darwin', 'arm64')))
      .toMatchObject({ platform: 'darwin', arch: 'arm64' })
    expect(parseCollectorLine(hello('win32', 'x64')))
      .toMatchObject({ platform: 'win32', arch: 'x64' })
    // A 32-bit collector sends x86; refusing it would kill that build on its first line, which is the
    // failure this vocabulary exists to avoid.
    expect(parseCollectorLine(hello('win32', 'x86')))
      .toMatchObject({ platform: 'win32', arch: 'x86' })
    // Every platform this product ships a collector for is accepted, Linux included: it was missing from
    // this vocabulary until 2026-10-05, and a Linux collector's hello was refused as a "platform mismatch"
    // even though the protocol, the fixture and the validation file all named Linux.
    expect(parseCollectorLine(hello('linux', 'arm64')))
      .toMatchObject({ platform: 'linux', arch: 'arm64' })
    // rustc's own arch words are not the host's vocabulary...
    expect(() => parseCollectorLine(hello('win32', 'x86_64')))
      .toThrow(/architecture/)
    // ...and a platform no collector claims is still refused.
    expect(() => parseCollectorLine(hello('freebsd', 'x64')))
      .toThrow(/platform/)
  })
})
