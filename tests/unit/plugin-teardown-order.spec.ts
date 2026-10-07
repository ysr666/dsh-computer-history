import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('plugin teardown ordering', () => {
  it('stops the companion intake through one shared promise before SQLite closes', () => {
    const source = readFileSync(
      new URL('../../src/host/plugin.ts', import.meta.url),
      'utf8',
    )

    // Cordis disposes effects concurrently. A separate intake effect is only
    // safe when the database-owning teardown awaits the exact same idempotent
    // stop promise before history.close().
    expect(source).toContain('let companionStopPromise: Promise<void> | undefined')
    expect(source).toContain('companionStopPromise ??=')

    const close = source.indexOf('history.close()')
    expect(close).toBeGreaterThan(0)
    const stopBeforeClose = source.lastIndexOf('await stopCompanion()', close)
    const drainBeforeClose = source.lastIndexOf('await backend.drain()', close)
    const releaseBeforeClose = source.lastIndexOf('await releaseCaptureOwnership()', close)
    expect(stopBeforeClose).toBeGreaterThan(0)
    expect(drainBeforeClose).toBeGreaterThan(stopBeforeClose)
    expect(releaseBeforeClose).toBeGreaterThan(drainBeforeClose)
    expect(releaseBeforeClose).toBeLessThan(close)

    const waitForStart = source.indexOf('await companionStarted')
    expect(waitForStart).toBeGreaterThan(0)
    expect(waitForStart).toBeLessThan(stopBeforeClose)
  })
})
