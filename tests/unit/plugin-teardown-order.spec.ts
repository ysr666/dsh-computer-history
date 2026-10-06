import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('plugin teardown ordering', () => {
  it('serializes intake stop before backend drain, capture release and SQLite close', () => {
    const source = readFileSync(
      new URL('../../src/host/plugin.ts', import.meta.url),
      'utf8',
    )

    // A bind in progress must not finish after ownership has been released.
    expect(source).toContain('let companionLifecycle: Promise<void> = Promise.resolve()')
    expect(source).toContain('enqueueCompanionLifecycle')

    const close = source.indexOf('history.close()')
    expect(close).toBeGreaterThan(0)
    const stop = source.lastIndexOf('await stopCompanionForOwner()', close)
    const drain = source.lastIndexOf('await backend.drain()', close)
    const release = source.lastIndexOf('await releaseCaptureOwnership()', close)
    expect(stop).toBeGreaterThan(0)
    expect(drain).toBeGreaterThan(stop)
    expect(release).toBeGreaterThan(drain)
    expect(release).toBeLessThan(close)
  })
})
