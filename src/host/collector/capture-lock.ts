import { withFileLock } from '@deepseek-ai/dsh-atomic-write'

export class CaptureOwnershipLock {
  private releaseHold: (() => void) | undefined
  private completion: Promise<void> | undefined

  private constructor(
    private readonly targetPath: string,
  ) {}

  public static async acquire(
    targetPath: string,
  ): Promise<CaptureOwnershipLock> {
    const lock = new CaptureOwnershipLock(targetPath)
    await lock.acquire()
    return lock
  }

  private async acquire(): Promise<void> {
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
      { waitMs: 0 },
    ).catch(error => {
      if (!entered) rejected(error)
      else throw error
    })
    await ready
  }

  public async release(): Promise<void> {
    const release = this.releaseHold
    const completion = this.completion

    this.releaseHold = undefined
    this.completion = undefined

    release?.()
    await completion
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
