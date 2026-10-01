import { createInterface } from 'node:readline'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type {
  CollectorHello,
  CollectorState,
  CollectorToHost,
  HostToCollector,
  PolicySnapshot,
} from '../../shared/index.js'
import { encodeCollectorCommand, parseCollectorLine } from './protocol.js'

export interface CollectorManagerOptions {
  readonly executable: string
  readonly cwd: string
  readonly graceMs?: number
  readonly onMessage: (message: CollectorToHost) => void | Promise<void>
}

export class CollectorManager {
  private handle: SubprocessHandle | undefined
  private hello?: CollectorHello
  private state?: CollectorState
  private stopping: Promise<void> | undefined

  public constructor(
    private readonly ctx: Context,
    private readonly options: CollectorManagerOptions,
  ) {}

  public start(): void {
    if (this.handle) throw new Error('collector already started')
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
    if (!handle.stdin || !handle.stdout) throw new Error('collector requires piped stdio')
    this.handle = handle
    const lines = createInterface({ input: handle.stdout, crlfDelay: Infinity })
    lines.on('line', line => {
      try {
        const message = parseCollectorLine(line)
        if (message.type === 'hello') this.hello = message
        if (message.type === 'state') this.state = message
        if (message.type === 'fatal') {
          this.state = {
            v: 1, type: 'state', state: 'degraded',
            accessibilityTrusted: this.state?.accessibilityTrusted ?? false,
            reason: message.code,
          }
        }
        void Promise.resolve(this.options.onMessage(message)).catch(() => this.stop('protocol-error'))
      } catch {
        void this.stop('protocol-error')
      }
    })
    void handle.done.finally(() => {
      lines.close()
      if (this.handle === handle) {
        this.handle = undefined
        if (!this.stopping) {
          this.state = {
            v: 1, type: 'state', state: 'degraded',
            accessibilityTrusted: this.state?.accessibilityTrusted ?? false,
            reason: 'collector-exited',
          }
        }
      }
    }).catch(() => {})
  }

  public send(message: HostToCollector): void {
    const stdin = this.handle?.stdin
    if (!stdin || stdin.destroyed) throw new Error('collector is not writable')
    stdin.write(encodeCollectorCommand(message))
  }

  public configure(policy: PolicySnapshot): void {
    const appRules = policy.rules.filter(rule => rule.dimension === 'app')
    const resourceRules = policy.rules.filter(rule => rule.dimension === 'resource')
    this.send({
      v: 1,
      type: 'configure',
      revision: policy.revision,
      policy: {
        mode: policy.mode,
        allowedBundleIds: appRules.filter(rule => rule.action === 'allow').map(rule => rule.pattern),
        blockedBundleIds: appRules.filter(rule => rule.action === 'deny').map(rule => rule.pattern),
        protectedBundleIds: appRules.filter(rule => rule.action === 'protect').map(rule => rule.pattern),
        protectedPathPatterns: resourceRules.filter(rule => rule.action !== 'allow').map(rule => rule.pattern),
      },
    })
  }

  public pause(): Promise<void> {
    this.send({ v: 1, type: 'pause' })
    this.state = {
      v: 1, type: 'state', state: 'paused',
      accessibilityTrusted: this.state?.accessibilityTrusted ?? false,
    }
    return Promise.resolve()
  }
  public resume(): Promise<void> {
    this.send({ v: 1, type: 'resume' })
    this.state = {
      v: 1, type: 'state', state: 'running',
      accessibilityTrusted: this.state?.accessibilityTrusted ?? false,
    }
    return Promise.resolve()
  }
  public snapshot(): { hello?: CollectorHello; state?: CollectorState } {
    return { ...(this.hello ? { hello: this.hello } : {}), ...(this.state ? { state: this.state } : {}) }
  }

  public stop(reason: 'plugin-dispose' | 'host-shutdown' | 'protocol-error' = 'plugin-dispose'): Promise<void> {
    if (this.stopping) return this.stopping
    const handle = this.handle
    if (!handle) return Promise.resolve()
    this.stopping = (async () => {
      try { this.send({ v: 1, type: 'shutdown', reason }) } catch {}
      try { handle.stdin?.end() } catch {}
      const bound = AbortSignal.timeout(this.options.graceMs ?? 1_500)
      let exited = false
      try { exited = await handle.waitForExit(bound) } catch {}
      if (!exited) {
        handle.terminate()
        await handle.waitForExit()
      }
      this.handle = undefined
    })().finally(() => { this.stopping = undefined })
    return this.stopping
  }
}
