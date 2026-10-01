import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import {
  MAX_PROTOCOL_LINE_BYTES,
  PHASE1_SUPPORTED_BUNDLE_IDS,
  policyRuleMatches,
  type CollectorHello,
  type CollectorState,
  type CollectorToHost,
  type HostToCollector,
  type PolicySnapshot,
} from '../../shared/index.js'
import {
  encodeCollectorCommand,
  parseCollectorLine,
} from './protocol.js'

const DEFAULT_RESTART_DELAYS_MS = [
  1_000,
  2_000,
  5_000,
  15_000,
  30_000,
] as const
const DEFAULT_CRASH_WINDOW_MS = 10 * 60 * 1000
const DEFAULT_MAX_CRASHES_IN_WINDOW = 5

export interface CollectorManagerOptions {
  readonly executable: string
  readonly cwd: string
  readonly graceMs?: number
  readonly helloTimeoutMs?: number
  readonly restartOnCrash?: boolean
  readonly restartDelaysMs?: readonly number[]
  readonly crashWindowMs?: number
  readonly maxCrashesInWindow?: number
  readonly onMessage:
    (message: CollectorToHost) => void | Promise<void>
  readonly onUnexpectedExit?: () => void | Promise<void>
}

export class CollectorManager {
  private handle: SubprocessHandle | undefined
  private hello: CollectorHello | undefined
  private state: CollectorState | undefined
  private stopping: Promise<void> | undefined
  private processing: Promise<void> = Promise.resolve()
  private controlQueue: Promise<void> = Promise.resolve()
  private receiveBuffer = Buffer.alloc(0)
  private lastObservationSeq: number | undefined
  private lastObservationFingerprint: string | undefined
  private helloTimer: NodeJS.Timeout | undefined
  private restartTimer: NodeJS.Timeout | undefined
  private crashTimes: number[] = []
  private shutdownRequested = false
  private unexpectedExitNotified = false
  private readonly stateWaiters: Array<{
    expected: 'paused' | 'running'
    resolve: () => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }> = []

  public constructor(
    private readonly ctx: Context,
    private readonly options: CollectorManagerOptions,
  ) {}

  public start(): void {
    if (this.handle || this.restartTimer) {
      throw new Error('collector already started')
    }

    this.shutdownRequested = false
    this.unexpectedExitNotified = false
    this.crashTimes = []
    this.spawnCollector()
  }

  private spawnCollector(): void {
    this.hello = undefined
    this.state = undefined
    this.lastObservationSeq = undefined
    this.lastObservationFingerprint = undefined

    const handle = this.ctx.subprocess.spawn({
      argv: [this.options.executable],
      cwd: this.options.cwd,
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: 32 * 1024 },
      },
      graceMs: this.options.graceMs ?? 1_500,
    })

    if (!handle.stdin || !handle.stdout) {
      try {
        handle.terminate()
      } catch {
        // Managed subprocess cleanup remains best-effort here.
      }
      void handle.waitForExit().catch(() => {})
      throw new Error('collector requires piped stdio')
    }

    this.handle = handle
    const onData = (chunk: Buffer | string): void => {
      const data = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk)

      this.receiveBuffer = Buffer.concat([
        this.receiveBuffer,
        data,
      ])

      try {
        this.drainProtocolLines()
      } catch {
        this.markDegraded('protocol-error')
        void this.stop('protocol-error')
      }
    }

    handle.stdout.on('data', onData)

    this.helloTimer = setTimeout(() => {
      if (
        this.handle === handle
        && !this.hello
        && !this.stopping
      ) {
        this.markDegraded('hello-timeout')
        void this.stop('protocol-error')
      }
    }, this.options.helloTimeoutMs ?? 5_000)
    this.helloTimer.unref()

    void handle.done.finally(() => {
      handle.stdout?.off('data', onData)
      this.clearHelloTimer()
      this.receiveBuffer = Buffer.alloc(0)
      this.rejectStateWaiters(
        new Error('collector exited before state acknowledgement'),
      )

      if (this.handle === handle) {
        this.handle = undefined
        this.hello = undefined
        if (!this.stopping && !this.shutdownRequested) {
          this.markDegraded('collector-exited')
          this.scheduleRestartAfterFailure()
        }
      }
    }).catch(() => {})
  }

  private scheduleRestartAfterFailure(): void {
    const now = Date.now()
    const windowMs =
      this.options.crashWindowMs ?? DEFAULT_CRASH_WINDOW_MS
    this.crashTimes = this.crashTimes.filter(
      timestamp => timestamp >= now - windowMs,
    )
    this.crashTimes.push(now)

    const maxFailures =
      this.options.maxCrashesInWindow
      ?? DEFAULT_MAX_CRASHES_IN_WINDOW
    if (
      this.options.restartOnCrash === false
      || this.crashTimes.length > maxFailures
    ) {
      this.shutdownRequested = true
      this.notifyUnexpectedExit()
      return
    }

    const delays =
      this.options.restartDelaysMs
      ?? DEFAULT_RESTART_DELAYS_MS
    const delay = delays[
      Math.min(
        this.crashTimes.length - 1,
        Math.max(0, delays.length - 1),
      )
    ] ?? 0

    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      if (this.shutdownRequested) return
      try {
        this.spawnCollector()
      } catch {
        this.markDegraded('collector-spawn-failed')
        this.scheduleRestartAfterFailure()
      }
    }, delay)
    this.restartTimer.unref()
  }

  private clearRestartTimer(): void {
    if (!this.restartTimer) return
    clearTimeout(this.restartTimer)
    this.restartTimer = undefined
  }

  private notifyUnexpectedExit(): void {
    if (this.unexpectedExitNotified) return
    this.unexpectedExitNotified = true
    void Promise.resolve(
      this.options.onUnexpectedExit?.(),
    ).catch(() => {})
  }

  private drainProtocolLines(): void {
    while (true) {
      const newline = this.receiveBuffer.indexOf(0x0a)
      if (newline < 0) {
        if (
          this.receiveBuffer.byteLength
          > MAX_PROTOCOL_LINE_BYTES
        ) {
          throw new Error(
            'collector protocol line exceeds byte limit',
          )
        }
        return
      }

      const lineBuffer = this.receiveBuffer.subarray(
        0,
        newline,
      )
      this.receiveBuffer = this.receiveBuffer.subarray(
        newline + 1,
      )

      const withoutCr = lineBuffer.at(-1) === 0x0d
        ? lineBuffer.subarray(0, -1)
        : lineBuffer

      if (
        withoutCr.byteLength
        > MAX_PROTOCOL_LINE_BYTES
      ) {
        throw new Error(
          'collector protocol line exceeds byte limit',
        )
      }
      if (withoutCr.byteLength === 0) continue

      this.acceptMessage(
        parseCollectorLine(withoutCr.toString('utf8')),
      )
    }
  }

  private acceptMessage(message: CollectorToHost): void {
    if (!this.hello && message.type !== 'hello') {
      throw new Error('collector must send hello first')
    }
    if (this.hello && message.type === 'hello') {
      throw new Error('collector sent duplicate hello')
    }

    if (message.type === 'hello') {
      this.clearHelloTimer()
      this.hello = message
      this.lastObservationSeq = undefined
    }
    if (message.type === 'observation') {
      if (message.collectorSession !== this.hello?.collectorSession) {
        throw new Error('collector session mismatch')
      }
      if (
        this.lastObservationSeq !== undefined
        && message.seq < this.lastObservationSeq
      ) {
        throw new Error('collector sequence regression')
      }
      const fingerprint = JSON.stringify(message)
      if (message.seq === this.lastObservationSeq) {
        if (fingerprint !== this.lastObservationFingerprint) {
          throw new Error('conflicting duplicate collector sequence')
        }
        return
      }
      this.lastObservationSeq = message.seq
      this.lastObservationFingerprint = fingerprint
    }
    if (message.type === 'state') {
      this.state = message
      this.resolveStateWaiters(message.state)
    }
    if (message.type === 'fatal') {
      this.markDegraded(message.code)
    }

    this.processing = this.processing
      .then(() => this.options.onMessage(message))
      .catch(() => {
        this.markDegraded('host-message-handler-error')
        this.handle?.terminate()
      })
  }

  private clearHelloTimer(): void {
    if (!this.helloTimer) return
    clearTimeout(this.helloTimer)
    this.helloTimer = undefined
  }

  private markDegraded(reason: string): void {
    this.state = {
      v: 1,
      type: 'state',
      state: 'degraded',
      accessibilityTrusted:
        this.state?.accessibilityTrusted ?? false,
      reason,
    }
  }

  private resolveStateWaiters(state: CollectorState['state']): void {
    for (let index = this.stateWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.stateWaiters[index]
      if (!waiter || waiter.expected !== state) continue
      clearTimeout(waiter.timer)
      this.stateWaiters.splice(index, 1)
      waiter.resolve()
    }
  }

  private rejectStateWaiters(error: Error): void {
    for (const waiter of this.stateWaiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  }

  private waitForState(
    expected: 'paused' | 'running',
  ): Promise<void> {
    if (this.state?.state === expected) return Promise.resolve()

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.stateWaiters.findIndex(
          waiter => waiter.resolve === resolve,
        )
        if (index >= 0) this.stateWaiters.splice(index, 1)
        const error = new Error(
          `collector did not acknowledge ${expected}`,
        )
        this.markDegraded(`${expected}-ack-timeout`)
        reject(error)
        // A control transition whose outcome cannot be confirmed must
        // fail closed. In particular, a pause timeout must never leave
        // an uncertain helper collecting in the background.
        void this.stop('protocol-error')
      }, this.options.graceMs ?? 1_500)
      timer.unref()
      this.stateWaiters.push({ expected, resolve, reject, timer })
    })
  }

  public send(message: HostToCollector): void {
    const stdin = this.handle?.stdin
    if (!stdin || stdin.destroyed) {
      throw new Error('collector is not writable')
    }
    stdin.write(encodeCollectorCommand(message))
  }

  public canConfigure(): boolean {
    return Boolean(
      this.handle
      && this.hello
      && !this.stopping,
    )
  }

  public configure(policy: PolicySnapshot): void {
    const appRules = policy.rules.filter(
      rule => rule.dimension === 'app',
    )
    const resourceRules = policy.rules.filter(
      rule => rule.dimension === 'resource',
    )
    const bundleIdsFor = (
      action: 'allow' | 'deny' | 'protect',
    ): string[] => PHASE1_SUPPORTED_BUNDLE_IDS.filter(
      bundleId => appRules.some(rule =>
        rule.action === action
        && policyRuleMatches(rule, bundleId),
      ),
    )

    try {
      this.send({
        v: 1,
        type: 'configure',
        revision: policy.revision,
        policy: {
          mode: 'include-only',
          allowedBundleIds: bundleIdsFor('allow'),
          blockedBundleIds: bundleIdsFor('deny'),
          protectedBundleIds: bundleIdsFor('protect'),
          protectedPathPatterns: resourceRules
            .filter(rule => rule.action !== 'allow')
            .map(rule =>
              rule.matcher === 'prefix'
                ? rule.pattern + '*'
                : rule.pattern,
            ),
        },
      })
    } catch (error) {
      this.markDegraded('configure-send-failed')
      void this.stop('protocol-error')
      throw error
    }
  }

  private enqueueControl(
    operation: () => Promise<void>,
  ): Promise<void> {
    const next = this.controlQueue.then(
      operation,
      operation,
    )
    this.controlQueue = next.catch(() => {})
    return next
  }

  public applyPolicy(
    policy: PolicySnapshot,
  ): Promise<void> {
    return this.enqueueControl(
      () => this.applyPolicyNow(policy),
    )
  }

  private async applyPolicyNow(
    policy: PolicySnapshot,
  ): Promise<void> {
    const priorState = this.state?.state

    if (priorState === 'paused') {
      this.configure(policy)
      return
    }

    await this.pauseNow()
    this.configure(policy)
    if (priorState === 'running') {
      await this.resumeNow()
    }
  }

  public pause(): Promise<void> {
    return this.enqueueControl(() => this.pauseNow())
  }

  private pauseNow(): Promise<void> {
    const acknowledgement = this.waitForState('paused')
    try {
      this.send({ v: 1, type: 'pause' })
    } catch (error) {
      this.rejectStateWaiters(
        error instanceof Error ? error : new Error(String(error)),
      )
      this.markDegraded('pause-send-failed')
      void this.stop('protocol-error')
      throw error
    }
    return acknowledgement
  }

  public resume(): Promise<void> {
    return this.enqueueControl(() => this.resumeNow())
  }

  private resumeNow(): Promise<void> {
    const acknowledgement = this.waitForState('running')
    try {
      this.send({ v: 1, type: 'resume' })
    } catch (error) {
      this.rejectStateWaiters(
        error instanceof Error ? error : new Error(String(error)),
      )
      this.markDegraded('resume-send-failed')
      void this.stop('protocol-error')
      throw error
    }
    return acknowledgement
  }

  public snapshot(): {
    hello?: CollectorHello
    state?: CollectorState
  } {
    return {
      ...(this.hello ? { hello: this.hello } : {}),
      ...(this.state ? { state: this.state } : {}),
    }
  }

  public stop(
    reason:
      | 'plugin-dispose'
      | 'host-shutdown'
      | 'protocol-error' = 'plugin-dispose',
  ): Promise<void> {
    if (this.stopping) return this.stopping

    this.shutdownRequested = true
    this.clearRestartTimer()
    this.clearHelloTimer()

    const handle = this.handle
    if (!handle) {
      if (reason === 'protocol-error') {
        this.notifyUnexpectedExit()
      }
      return this.processing.catch(() => {})
    }

    this.stopping = (async () => {
      try {
        this.send({
          v: 1,
          type: 'shutdown',
          reason,
        })
      } catch {
        // The process may already have closed stdin.
      }

      try {
        handle.stdin?.end()
      } catch {
        // The process may already have closed stdin.
      }

      const bound = AbortSignal.timeout(
        this.options.graceMs ?? 1_500,
      )
      let exited = false
      try {
        exited = await handle.waitForExit(bound)
      } catch {
        exited = false
      }

      if (!exited) {
        handle.terminate()
        await handle.waitForExit()
      }

      await this.processing.catch(() => {})
      this.handle = undefined
      if (reason === 'protocol-error') {
        this.notifyUnexpectedExit()
      }
    })().finally(() => {
      this.stopping = undefined
    })

    return this.stopping
  }
}
