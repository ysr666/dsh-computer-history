import { describe, expect, it } from 'vitest'
import { parseCollectorLine } from '../../src/host/collector/protocol.js'

/**
 * The four lines a Linux collector sends, captured from the real binary (Ubuntu 24.04 in a VM, kernel 6.8,
 * aarch64, 2026-10-05). The host refused the first one - `collector platform mismatch` - because the accepted
 * platform list was written when there were two collectors, which is why the Linux row could not exist.
 */
const LINUX_LINES = [
  '{"v":1,"type":"hello","collectorSession":"linux-43178","collectorVersion":"0.1.0","platform":"linux","arch":"arm64","capabilities":["app-focus","window-metadata","secure-field-detection"]}',
  '{"v":1,"type":"state","state":"running","accessibilityTrusted":true}',
  '{"v":1,"type":"configured","revision":1}',
  '{"v":1,"type":"observation","collectorSession":"linux-43178","seq":1,"observedAtMs":1791140773498,"app":{"pid":6466,"bundleId":"org.gnome.Terminal.desktop","name":"gnome-terminal-server"},"window":{"title":null,"document":null,"url":null},"element":{"role":"terminal","subrole":null,"identifier":null},"privacy":{"secure":false,"protected":false},"source":{"adapter":"terminal","provider":"at-spi"}}',
]

describe('the hello handshake', () => {
  it('accepts every platform this product ships a collector for', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const line = JSON.stringify({
        v: 1,
        type: 'hello',
        collectorSession: 's1',
        collectorVersion: '0.1.0',
        platform,
        arch: 'arm64',
        capabilities: ['app-focus'],
      })
      expect(parseCollectorLine(line).type).toBe('hello')
    }
  })

  it('still refuses a platform no collector claims', () => {
    const line = JSON.stringify({
      v: 1,
      type: 'hello',
      collectorSession: 's1',
      collectorVersion: '0.1.0',
      platform: 'freebsd',
      arch: 'arm64',
      capabilities: ['app-focus'],
    })
    expect(() => parseCollectorLine(line)).toThrow(/platform mismatch/)
  })

  it('accepts the lines a Linux collector really sends and preserves its provenance', () => {
    for (const line of LINUX_LINES) {
      expect(() => parseCollectorLine(line), line.slice(0, 60)).not.toThrow()
    }
    const observation = parseCollectorLine(LINUX_LINES[3]!)
    expect(observation.type).toBe('observation')
    if (observation.type === 'observation') {
      expect(observation.source.provider).toBe('at-spi')
    }
  })
})
