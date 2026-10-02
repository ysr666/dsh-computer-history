import { withFileLock } from '@deepseek-ai/dsh-atomic-write'

/**
 * How long a startup probe tolerates contention before concluding
 * that another live DSH Host owns ambient capture.
 *
 * Zero wait is wrong for that probe: an outgoing owner hands the lock
 * back asynchronously, so a successor probing inside that window would
 * spuriously report "owned by another DSH Host" and remain a read-only
 * client even though capture is actually free.
 *
 * The bound must outlast a normal handover, and shutdown releases
 * ownership as soon as it has bounded proof the helper is gone rather
 * than after its message drain. So the budget is derived from the two
 * exit waits that actually precede the release, not hard-coded. A
 * genuinely long-lived owner still wins once the wait expires.
 */
/**
 * How long the shutdown sequence waits for each boundary. Shared so the
 * probe budget below and the collector's own exit waits cannot drift
 * apart, and overridable where a caller configures a different grace.
 */
export const DEFAULT_SHUTDOWN_GRACE_MS = 1_500

/**
 * Exit waits shutdown performs before it releases ownership: the
 * graceful wait, then the forced wait after `terminate()`. The message
 * drain runs afterwards and is deliberately not part of this budget.
 * The probe allows 1.5x their total as margin for the release itself.
 */
const SHUTDOWN_EXIT_WAITS = 2

export const CAPTURE_LOCK_PROBE_WAIT_MS =
  DEFAULT_SHUTDOWN_GRACE_MS * SHUTDOWN_EXIT_WAITS * 1.5

export class CaptureOwnershipLock {
  private releaseHold: (() => void) | undefined
  private completion: Promise<void> | undefined
  private releaseRequested = false
  private releasing: Promise<void> | undefined
  private readonly leases = new Set<symbol>()
  private readonly leaseDrainWaiters: Array<() => void> = []

  private constructor(
    private readonly targetPath: string,
  ) {}

  public static async acquire(
    targetPath: string,
  ): Promise<CaptureOwnershipLock> {
    const lock = new CaptureOwnershipLock(targetPath)
    await lock.hold(0)
    return lock
  }

  /**
   * Acquire ownership, tolerating brief contention, or return
   * `undefined` when a live owner is genuinely holding capture.
   * Used by the Host's startup probe.
   */
  public static async tryAcquire(
    targetPath: string,
    waitMs: number = CAPTURE_LOCK_PROBE_WAIT_MS,
  ): Promise<CaptureOwnershipLock | undefined> {
    const lock = new CaptureOwnershipLock(targetPath)
    try {
      await lock.hold(waitMs)
      return lock
    } catch (error) {
      if (isCaptureOwnershipContention(error)) return undefined
      throw error
    }
  }

  private async hold(waitMs: number): Promise<void> {
    let acquired!: () => void
    let rejected!: (error: unknown) => void
    const ready = new Promise<void>(
      (resolve, reject) => {
        acquired = resolve
        rejected = reject
      },
    )

    const hold = new Promise<void>(resolve => {
      this.releaseHold = resolve
    })

    let entered = false
    this.completion = withFileLock(
      this.targetPath,
      async () => {
        entered = true
        acquired()
        await hold
      },
      { waitMs },
    ).catch(error => {
      if (!entered) rejected(error)
      else throw error
    })
    await ready
  }

  public acquireLease(): () => Promise<void> {
    if (this.releaseRequested || !this.completion) {
      throw new Error('capture ownership is releasing')
    }

    const token = Symbol('capture-ownership-lease')
    this.leases.add(token)
    let released = false

    return async () => {
      if (released) return
      released = true
      this.leases.delete(token)

      if (this.leases.size === 0) {
        for (const resolve of this.leaseDrainWaiters.splice(0)) {
          resolve()
        }
      }
    }
  }

  private waitForLeaseDrain(): Promise<void> {
    if (this.leases.size === 0) return Promise.resolve()
    return new Promise<void>(resolve => {
      this.leaseDrainWaiters.push(resolve)
    })
  }

  public release(): Promise<void> {
    if (this.releasing) return this.releasing

    this.releaseRequested = true
    this.releasing = (async () => {
      await this.waitForLeaseDrain()

      const release = this.releaseHold
      const completion = this.completion

      this.releaseHold = undefined
      this.completion = undefined

      release?.()
      await completion
    })()

    return this.releasing
  }
}

export function isCaptureOwnershipContention(
  error: unknown,
): boolean {
  return error instanceof Error
    && error.message.includes(
      'timed out waiting for the writer lock',
    )
}
