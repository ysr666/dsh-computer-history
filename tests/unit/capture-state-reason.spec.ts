import { describe, expect, it } from 'vitest'
import type { CollectorManager } from '../../src/host/collector/manager.js'
import { ManagedCapture } from '../../src/host/plugin.js'

const companion = () => ({ listening: false, paired: false })
const noRules = () => ({ revision: 1, mode: 'include-only' as const, updatedAtMs: 0, rules: [] })
const oneAppAllowed = () => ({
  revision: 2,
  mode: 'include-only' as const,
  updatedAtMs: 0,
  rules: [{
    id: 'preset:com.apple.Terminal' as never,
    dimension: 'app' as const,
    action: 'allow' as const,
    matcher: 'exact' as const,
    pattern: 'com.apple.Terminal',
    builtIn: false,
    createdAtMs: 0,
    updatedAtMs: 0,
  }],
})

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
      oneAppAllowed,
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
      oneAppAllowed,
      companion,
    )
    expect(capture.getState().reason).toBe('hello-timeout')
  })

  /**
   * Measured 2026-10-06 on the Windows machine: a spawned collector that never handshakes leaves the manager
   * without a state, and `getState()` then fell back to `'degraded'` with **no reason at all**. The manager is
   * right not to claim a state it has not seen; the Host that owns capture and has not heard from the collector
   * yet is a fact, and it has a name.
   */
  it('names the wait while a Host that owns capture has not heard from the collector yet', () => {
    const capture = new ManagedCapture(
      () => managerWithoutState(),
      true,
      () => true,
      async () => {},
      oneAppAllowed,
      companion,
    )
    expect(capture.getState().reason).toBe('collector-starting')
  })
})

/**
 * Measured 2026-10-06 on the owner's machine, and reproduced in an isolated Host: capture was `running`, the
 * collector was alive and handshaken, `refusedByReason` was empty - and the store held nothing, because the
 * policy's allow list was empty (the initial policy is include-only with only the built-in protections). The
 * product said it was recording while it recorded nothing. That is the silence this names.
 */
describe('a policy that allows nothing', () => {
  const runningManager = () => ({
    snapshot: () => ({
      state: { state: 'running', accessibilityTrusted: true },
      hello: { collectorVersion: '0.1.0', arch: 'arm64' },
    }),
  }) as unknown as CollectorManager

  it('is named instead of reported as running-and-fine', () => {
    const capture = new ManagedCapture(
      () => runningManager(),
      true,
      () => true,
      async () => {},
      noRules,
      companion,
    )
    expect(capture.getState().capture).toBe('running')
    expect(capture.getState().reason).toBe('no-apps-allowed')
  })

  it('stays quiet once one application is allowed', () => {
    const capture = new ManagedCapture(
      () => runningManager(),
      true,
      () => true,
      async () => {},
      oneAppAllowed,
      companion,
    )
    expect(capture.getState().reason).toBeUndefined()
  })
})
