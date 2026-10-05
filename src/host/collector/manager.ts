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
  DEFAULT_SHUTDOWN_GRACE_MS,
} from './capture-lock.js'
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
/**
 * Budget for a control acknowledgement. This is deliberately larger
 * than the subprocess grace period: the helper only emits `configured`
 * after synchronous Accessibility work on its main thread, so a briefly
 * unresponsive target application must not be mistaken for a dead
 * helper and cost this Host its capture ownership.
 */
const DEFAULT_ACK_TIMEOUT_MS = 5_000

/**
 * Bound for draining in-flight message handling. This is deliberately
 * much larger than the process grace period: a message handler may be
 * awaiting workspace canonicalization and ingestion, whose own failure
 * modes surface within this window. Abandoning that work early would
 * lose an observation, so the drain waits well past the point where
 * well-behaved work has finished.
 */
const DEFAULT_DRAIN_TIMEOUT_MS = 15_000

/**
 * Absolute bound on the whole shutdown sequence. Each individual wait is
 * bounded by `graceMs`, and a successor Host's ownership probe must be
 * able to outlast their sum, so the total is what callers reason about.
 */
export function shutdownBudgetMs(graceMs: number): number {
  return graceMs * 3
}

/**
 * Await `work`, but never longer than `ms`. Used on the shutdown path
 * so that a subprocess or handler which never settles cannot prevent
 * capture ownership from being handed back.
 */
async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), ms)
        timer.unref()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
const DEFAULT_CRASH_WINDOW_MS = 10 * 60 * 1000
const DEFAULT_MAX_CRASHES_IN_WINDOW = 5

export interface CollectorManagerOptions {
  readonly executable: string
  readonly cwd: string
  readonly graceMs?: number
  readonly ackTimeoutMs?: number
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
  private ownershipRelease: Promise<void> | undefined
  private desiredCaptureState: 'running' | 'paused' = 'running'
  private pendingPolicyAck: {
    revision: number
    resolve: () => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  } | undefined
  private readonly stateWaiters: Array<{
    expected: 'paused' | 'running'
    accepts(state: CollectorState['state']): boolean
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
    this.ownershipRelease = undefined
    this.crashTimes = []
    this.spawnCollector()
  }

  /**
   * Retry a collector that has exhausted its automatic crash recovery.
   *
   * Ownership is deliberately not managed here: the plugin must hold the
   * capture lock before calling this method. The manager keeps the user's
   * desired pause/running state across recovery and only resolves once the
   * replacement helper has acknowledged that state.
   */
  public async recover(): Promise<void> {
    if (this.stopping) {
      throw new Error('collector shutdown is still in progress')
    }
    if (this.handle) {
      throw new Error('collector is already running')
    }

    this.clearRestartTimer()
    this.shutdownRequested = false
    this.unexpectedExitNotified = false
    this.ownershipRelease = undefined
    this.crashTimes = []
    this.spawnCollector()

    // A state acknowledgement alone is not enough to call recovery complete.
    // The hello handler configures the current policy through `processing`; if
    // recovery resolved on `running` first, the UI could report success while
    // the first configure acknowledgement was still outstanding (and could
    // still fail a moment later). Wait through that processing chain so a
    // successful recovery means both capture state and initial policy are live.
    await this.waitForState(this.desiredCaptureState)
    await this.processing

    const recoveredState = this.state?.state
    const healthy = recoveredState === this.desiredCaptureState
      || (
        this.desiredCaptureState === 'running'
        && recoveredState === 'permission-required'
      )
    if (!healthy) {
      throw new Error(
        `collector recovery did not become healthy${
          this.state?.reason ? `: ${this.state.reason}` : ''
        }`,
      )
    }
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
      graceMs: this.options.graceMs ?? DEFAULT_SHUTDOWN_GRACE_MS,
    })

    if (!handle.stdin || !handle.stdout) {
      try {
        handle.terminate()
      } catch {
        // Managed subprocess cleanup remains best-effort here.
      }
      // A collector that dies while the host is not stopping it used to leave the interface saying it was
      // recording. The degraded path existed, but only inside the handshake and stop sequences, where
      // something is waiting for the child - and an out-of-band death is the case a user actually meets:
      // a crash, an out-of-memory kill, or someone killing the process. Observing the exit here is what
      // closes that gap; swallowing it was the whole defect.
      void handle
        .waitForExit()
        .catch(() => {})
        .finally(() => {
          if (this.stopping || this.shutdownRequested) return
          this.markDegraded('collector-exited-unexpectedly')
          void this.notifyUnexpectedExit()
        })
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
      } catch (error) {
        const failure = error instanceof Error
          ? error
          : new Error(String(error))
        this.markDegraded('protocol-error')
        this.rejectStateWaiters(failure)
        this.rejectPolicyAck(failure)
        void this.stop('protocol-error').catch(() => {})
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
        void this.stop('protocol-error').catch(() => {})
      }
    }, this.options.helloTimeoutMs ?? 5_000)
    this.helloTimer.unref()

    void handle.done.finally(() => {
      handle.stdout?.off('data', onData)
      this.clearHelloTimer()
      this.receiveBuffer = Buffer.alloc(0)
      const exitError = new Error(
        'collector exited before acknowledgement',
      )
      this.rejectStateWaiters(exitError)
      this.rejectPolicyAck(exitError)

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
      || this.crashTimes.length >= maxFailures
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

  private notifyUnexpectedExit(): Promise<void> {
    this.unexpectedExitNotified = true
    const release = Promise.resolve(
      this.options.onUnexpectedExit?.(),
    )
    this.ownershipRelease = release
    return release
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
    if (message.type === 'configured') {
      this.resolvePolicyAck(message.revision)
    }
    if (message.type === 'fatal') {
      this.markDegraded(message.code)
      void this.stop('protocol-error').catch(() => {})
    }

    this.processing = this.processing
      .then(() => this.options.onMessage(message))
      .catch(() => {
        if (this.state?.state !== 'degraded') {
          this.markDegraded('host-message-handler-error')
        }
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

  private waitForPolicyAck(
    revision: number,
  ): Promise<void> {
    if (this.pendingPolicyAck) {
      throw new Error(
        'collector policy acknowledgement already pending',
      )
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingPolicyAck?.revision !== revision) return
        this.pendingPolicyAck = undefined
        const error = new Error(
          `collector did not acknowledge policy revision ${revision}`,
        )
        this.markDegraded('configure-ack-timeout')
        reject(error)
        void this.stop('protocol-error').catch(() => {})
      }, this.options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS)
      timer.unref()
      this.pendingPolicyAck = {
        revision,
        resolve,
        reject,
        timer,
      }
    })
  }

  private resolvePolicyAck(revision: number): void {
    const pending = this.pendingPolicyAck
    if (!pending) {
      throw new Error(
        'collector sent unexpected policy acknowledgement',
      )
    }
    if (pending.revision !== revision) {
      throw new Error(
        `collector policy acknowledgement mismatch: expected ${pending.revision}, received ${revision}`,
      )
    }

    clearTimeout(pending.timer)
    this.pendingPolicyAck = undefined
    pending.resolve()
  }

  private rejectPolicyAck(error: Error): void {
    const pending = this.pendingPolicyAck
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingPolicyAck = undefined
    pending.reject(error)
  }

  private cancelPolicyAck(): void {
    const pending = this.pendingPolicyAck
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingPolicyAck = undefined
  }

  private resolveStateWaiters(state: CollectorState['state']): void {
    for (let index = this.stateWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.stateWaiters[index]
      if (!waiter || !waiter.accepts(state)) continue
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
    // A `resume` is satisfied by `permission-required` as well: native
    // resumes collection but reports the accessibility gate instead of
    // `running`. Treating that as a timeout would kill a healthy helper
    // and release capture ownership, and every later pause/resume would
    // then fail until the plugin reloaded.
    const accepts = (state: CollectorState['state']): boolean =>
      state === expected
      || (expected === 'running' && state === 'permission-required')

    if (this.state && accepts(this.state.state)) {
      return Promise.resolve()
    }

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
        void this.stop('protocol-error').catch(() => {})
      }, this.options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS)
      timer.unref()
      this.stateWaiters.push({
        expected,
        accepts,
        resolve,
        reject,
        timer,
      })
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

  private sendConfigure(policy: PolicySnapshot): void {
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
  }

  private configureAndWait(
    policy: PolicySnapshot,
  ): Promise<void> {
    const acknowledgement = this.waitForPolicyAck(
      policy.revision,
    )
    try {
      this.sendConfigure(policy)
    } catch (error) {
      this.cancelPolicyAck()
      this.markDegraded('configure-send-failed')
      void this.stop('protocol-error').catch(() => {})
      throw error
    }
    return acknowledgement
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

  public initialize(
    policy: PolicySnapshot,
  ): Promise<void> {
    return this.enqueueControl(async () => {
      if (this.desiredCaptureState === 'paused') {
        await this.pauseNow()
      }
      await this.configureAndWait(policy)
    })
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
    // A user-requested pause always wins, and only a positively-running
    // helper can be quiesced by the pause/configure/resume dance. Any
    // other state (paused, permission-required, degraded, or not yet
    // handshaken) is already fail-closed for collection, and pausing it
    // would be actively harmful: a paused helper emits no state
    // transitions, so the Host would either wedge capture or time out
    // waiting for a resume that can never be acknowledged while
    // Accessibility is untrusted.
    //
    // Both branches live under one try: this method runs during the Host's own start-up, and a collector that is
    // gone cannot be told anything. The control helpers below deliberately throw, because a caller that asked for
    // one operation has to hear that it failed - but letting that error escape here made the plugin fail to load
    // and took the whole Host down with it (measured 2026-10-05: `dsh: fatal load failure: Error: collector is
    // not writable`, reproduced with the collector's process already exited). The design's answer for a collector
    // that cannot be reached is a named degraded state with the Host up, so that is what happens here.
    try {
      if (
        priorState !== 'running'
        || this.desiredCaptureState === 'paused'
      ) {
        await this.configureAndWait(policy)
        return
      }

      await this.pauseNow()
      await this.configureAndWait(policy)
      await this.resumeNow()
    } catch (error) {
      this.rejectStateWaiters(
        error instanceof Error ? error : new Error(String(error)),
      )
      this.markDegraded('apply-policy-send-failed')
      void this.stop('protocol-error').catch(() => {})
    }
  }

  public pause(): Promise<void> {
    this.desiredCaptureState = 'paused'
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
      void this.stop('protocol-error').catch(() => {})
      throw error
    }
    return acknowledgement
  }

  public resume(): Promise<void> {
    this.desiredCaptureState = 'running'
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
      void this.stop('protocol-error').catch(() => {})
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
    const stopError = new Error(
      'collector stopped before acknowledgement',
    )
    this.rejectStateWaiters(stopError)
    this.rejectPolicyAck(stopError)

    const handle = this.handle
    if (!handle) {
      // No live process: the only remaining obligation is that the
      // caller can observe ownership having been handed back.
      // `releaseOwnership` is idempotent, so every reason takes it.
      const release = this.releaseOwnership()
      this.stopping = release
      return release.finally(() => {
        this.stopping = undefined
      })
    }

    const stopping = (async () => {
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
        this.options.graceMs ?? DEFAULT_SHUTDOWN_GRACE_MS,
      )
      let exited = false
      try {
        // The signal is advisory: a provider that ignores it would
        // otherwise hold the ownership handover open indefinitely.
        exited = await withTimeout(
          handle.waitForExit(bound),
          this.options.graceMs ?? DEFAULT_SHUTDOWN_GRACE_MS,
        ) === true
      } catch {
        exited = false
      }

      if (!exited) {
        // The subprocess contract permits both of these to throw, and
        // an exit wait that never settles would block the ownership
        // handover below. Every step is bounded.
        try {
          handle.terminate()
        } catch {
          // Best-effort signal; the ownership release still runs.
        }
        // `waitForExit()` reports true only once the managed range is
        // empty, so its result is the confirmation that no helper is
        // left behind when ownership moves to a successor.
        try {
          exited = await withTimeout(
            handle.waitForExit(),
            this.options.graceMs ?? DEFAULT_SHUTDOWN_GRACE_MS,
          ) === true
        } catch {
          exited = false
        }
        if (!exited) {
          this.markDegraded('collector-exit-unconfirmed')
        }
      }

      // Cleared before the drain: the process is already gone at this
      // point, so a handler failure during the drain has nothing left to
      // terminate and must not reach for a replacement handle.
      this.handle = undefined

      // Ownership is released as soon as no helper is left behind, and
      // deliberately BEFORE the message drain below. The lock serializes
      // *collectors*; it does not guard database writers, and the drain
      // can take much longer than the exit waits. Releasing first keeps
      // a successor Host's probe budget tied to the exit sequence rather
      // than to how long an in-flight write happens to take.
      //
      // A successor may start its own collector while this Host is still
      // draining a message. That is safe: both Hosts write to the same
      // store through the same uniqueness and tombstone rules, so a
      // message this Host is still finishing cannot duplicate or
      // resurrect anything the successor persists.
      //
      // When the helper could not be confirmed gone the lock is still
      // released. The alternative — holding it indefinitely — would make
      // ambient capture permanently unavailable for this data directory,
      // and the helper has already received `shutdown` plus `terminate`.
      // The degraded state above records that the exit was unconfirmed.
      await this.releaseOwnership()

      // In-flight message handling (including ingestion) must not be
      // able to hold ownership hostage, but a genuinely in-flight write
      // gets a much larger budget than the process grace period so that
      // legitimate work is not lost.
      try {
        await withTimeout(
          this.processing,
          DEFAULT_DRAIN_TIMEOUT_MS,
        )
      } catch {
        // stop() resolving is not conditional on the drain.
      }
    })()
    this.stopping = stopping

    return stopping.finally(() => {
      this.stopping = undefined
    })
  }

  private releaseOwnership(): Promise<void> {
    if (this.unexpectedExitNotified) {
      return this.ownershipRelease ?? Promise.resolve()
    }
    this.unexpectedExitNotified = true
    return this.notifyUnexpectedExit()
  }
}
