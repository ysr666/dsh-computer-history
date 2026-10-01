import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import {
  MAX_PROTOCOL_LINE_BYTES,
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

export interface CollectorManagerOptions {
  readonly executable: string
  readonly cwd: string
  readonly graceMs?: number
  readonly onMessage:
    (message: CollectorToHost) => void | Promise<void>
}

export class CollectorManager {
  private handle: SubprocessHandle | undefined
  private hello: CollectorHello | undefined
  private state: CollectorState | undefined
  private stopping: Promise<void> | undefined
  private processing: Promise<void> = Promise.resolve()
  private receiveBuffer = Buffer.alloc(0)

  public constructor(
    private readonly ctx: Context,
    private readonly options: CollectorManagerOptions,
  ) {}

  public start(): void {
    if (this.handle) {
      throw new Error('collector already started')
    }

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

    void handle.done.finally(() => {
      handle.stdout?.off('data', onData)
      this.receiveBuffer = Buffer.alloc(0)

      if (this.handle === handle) {
        this.handle = undefined
        if (!this.stopping) {
          this.markDegraded('collector-exited')
        }
      }
    }).catch(() => {})
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
    if (message.type === 'hello') {
      this.hello = message
    }
    if (message.type === 'state') {
      this.state = message
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

  public send(message: HostToCollector): void {
    const stdin = this.handle?.stdin
    if (!stdin || stdin.destroyed) {
      throw new Error('collector is not writable')
    }
    stdin.write(encodeCollectorCommand(message))
  }

  public configure(policy: PolicySnapshot): void {
    const appRules = policy.rules.filter(
      rule => rule.dimension === 'app',
    )
    const resourceRules = policy.rules.filter(
      rule => rule.dimension === 'resource',
    )

    this.send({
      v: 1,
      type: 'configure',
      revision: policy.revision,
      policy: {
        mode: policy.mode,
        allowedBundleIds: appRules
          .filter(rule => rule.action === 'allow')
          .map(rule => rule.pattern),
        blockedBundleIds: appRules
          .filter(rule => rule.action === 'deny')
          .map(rule => rule.pattern),
        protectedBundleIds: appRules
          .filter(rule => rule.action === 'protect')
          .map(rule => rule.pattern),
        protectedPathPatterns: resourceRules
          .filter(rule => rule.action !== 'allow')
          .map(rule => rule.pattern),
      },
    })
  }

  public pause(): Promise<void> {
    this.send({ v: 1, type: 'pause' })
    this.state = {
      v: 1,
      type: 'state',
      state: 'paused',
      accessibilityTrusted:
        this.state?.accessibilityTrusted ?? false,
    }
    return Promise.resolve()
  }

  public resume(): Promise<void> {
    this.send({ v: 1, type: 'resume' })
    this.state = {
      v: 1,
      type: 'state',
      state: 'running',
      accessibilityTrusted:
        this.state?.accessibilityTrusted ?? false,
    }
    return Promise.resolve()
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

    const handle = this.handle
    if (!handle) {
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
    })().finally(() => {
      this.stopping = undefined
    })

    return this.stopping
  }
}
