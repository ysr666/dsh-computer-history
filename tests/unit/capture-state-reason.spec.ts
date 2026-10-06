import { describe, expect, it } from 'vitest'
import type { CollectorManager } from '../../src/host/collector/manager.js'
import { ManagedCapture } from '../../src/host/plugin.js'

const companion = () => ({ listening: false, paired: false })

/** A Host that did not get the capture lock can still hold a manager object. */
const managerWithoutState = () => ({ snapshot: () => ({}) }) as unknown as CollectorManager

describe('capture state honesty', () => {
  /**
   * Measured 2026-10-06 on the Windows machine: the state read `capture: degraded` with **no reason**, although
   * the plugin knew it did not own capture. The named reason that exists for exactly this case was suppressed,
   * because the branch tested for a manager object instead of for ownership - and a manager object is created by
   * a start attempt or a recovery, so it is not evidence of owning anything.
   */
  it('names the reason when capture is not owned, even though a manager object exists', () => {
    const capture = new ManagedCapture(
      () => managerWithoutState(),
      true,
      () => false,
      async () => {},
      companion,
    )
    const state = capture.getState()
    expect(state.capture).toBe('degraded')
    expect(state.reason).toBe('capture-owned-by-another-host')
  })

  it('lets the manager own reason win when it has one', () => {
    const capture = new ManagedCapture(
      () => ({
        snapshot: () => ({
          state: { state: 'degraded', accessibilityTrusted: false, reason: 'hello-timeout' },
        }),
      }) as unknown as CollectorManager,
      true,
      () => false,
      async () => {},
      companion,
    )
    expect(capture.getState().reason).toBe('hello-timeout')
  })

  it('stays unnamed while a Host that owns capture is still handshaking', () => {
    const capture = new ManagedCapture(
      () => managerWithoutState(),
      true,
      () => true,
      async () => {},
      companion,
    )
    expect(capture.getState().reason).toBeUndefined()
  })
})
