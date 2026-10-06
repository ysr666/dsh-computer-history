import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('plugin teardown ordering', () => {
  it('serializes companion lifecycle and stops it before SQLite closes', () => {
    const source = readFileSync(
      new URL('../../src/host/plugin.ts', import.meta.url),
      'utf8',
    )

    // A bind already in progress must not finish after a later ownership stop.
    expect(source).toContain('let companionLifecycle: Promise<void> = Promise.resolve()')
    expect(source).toContain('enqueueCompanionLifecycle')

    const close = source.indexOf('history.close()')
    expect(close).toBeGreaterThan(0)
    const stopBeforeClose = source.lastIndexOf(
      'await stopCompanionForOwner()',
      close,
    )
    expect(stopBeforeClose).toBeGreaterThan(0)
    expect(stopBeforeClose).toBeLessThan(close)
  })

  it('quiesces backend controls before releasing capture ownership', () => {
    const source = readFileSync(
      new URL('../../src/host/plugin.ts', import.meta.url),
      'utf8',
    )
    const teardown = source.indexOf("computer-history: teardown")
    expect(teardown).toBeGreaterThan(0)

    const drain = source.lastIndexOf('await backend.drain()', teardown)
    const release = source.lastIndexOf('await releaseCaptureOwnership()', teardown)
    const close = source.lastIndexOf('history.close()', teardown)

    expect(drain).toBeGreaterThan(0)
    expect(release).toBeGreaterThan(drain)
    expect(close).toBeGreaterThan(release)
  })
})
