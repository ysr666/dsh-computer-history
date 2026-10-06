import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-agent'
import '@deepseek-ai/dsh-client-connection'
import '@deepseek-ai/dsh-subprocess'
import '@deepseek-ai/dsh-workspace'
import { registerAgentIntegration } from '../agent/index.js'
import {
  presetBundles,
  readFirstRunPreset,
  findStaleInstall,
  runningRelease,
  type CollectorToHost,
  type ComputerHistoryState,
  type PolicySnapshot,
} from '../shared/index.js'
import { registerHistoryApi } from './api/index.js'
import { CompanionIntake } from './companion/intake.js'
import { companionObservation } from './companion/observation.js'
import { CompanionTokenStore } from './companion/token-store.js'
import { SemanticOptInStore } from './semantic/opt-in.js'
import {
  CAPTURE_LOCK_PROBE_WAIT_MS,
  CaptureOwnershipLock,
  CollectorManager,
} from './collector/index.js'
import { IngestionService } from './ingestion/index.js'
import { DeletionService, RetentionService } from './retention/index.js'
import { RetentionSettingsStore } from './store/retention-settings.js'
import {
  ComputerHistoryService,
  LocalComputerHistoryBackend,
  type CaptureController,
} from './service/index.js'
import {
  EpisodeStore,
  openHistoryDatabase,
  PolicyStore,
} from './store/index.js'
import { DshWorkspaceResolver } from './workspace-resolver.js'

export const name = 'dsh-computer-history'
export const inject = [
  'subprocess', 'connection', 'workspaceRegistry',
  'agents', 'tools', 'systemPrompt',
]

export interface Config {
  readonly enabled?: boolean
  readonly dataDirectory?: string
  readonly collectorExecutable?: string
  readonly autoResume?: boolean
  readonly collectorRestart?: boolean
  readonly captureLockProbeWaitMs?: number
  /** Loopback port for the browser companion intake (ADR 0007). */
  readonly companionPort?: number

}

export function resolveHistoryDataDirectory(
  config: Config = {},
): string {
  return config.dataDirectory
    ?? dshHomePath('computer-history')
}

export class ManagedCapture implements CaptureController {
  public constructor(
    private readonly manager: () => CollectorManager | undefined,
    private readonly enabled: boolean,
    private readonly ownsCapture: () => boolean,
    private readonly recoverCapture: () => Promise<void>,
    private readonly policy: () => PolicySnapshot,
    private readonly companion: () => NonNullable<
      ComputerHistoryState['companion']
    > = () => ({ listening: false, paired: false }),
  ) {}

  private requireOwnedManager(): CollectorManager {
    if (!this.enabled) {
      throw new Error('computer history capture is disabled')
    }
    const manager = this.manager()
    if (!manager) {
      throw new Error(
        'computer history capture is owned by another DSH Host',
      )
    }
    if (!this.ownsCapture()) {
      throw new Error(
        'computer history capture is unavailable on this DSH Host',
      )
    }
    return manager
  }

  public async pause(): Promise<void> {
    await this.requireOwnedManager().pause()
  }

  public async resume(): Promise<void> {
    await this.requireOwnedManager().resume()
  }

  public async recover(): Promise<void> {
    if (!this.enabled) {
      throw new Error('computer history capture is disabled')
    }
    await this.recoverCapture()
  }

  /**
   * The companion listener's state, so the pairing route reports where the
   * intake actually listens instead of assuming it started.
   */
  public getCompanionState(): NonNullable<
    ComputerHistoryState['companion']
  > {
    return this.companion()
  }

  public getState(): Pick<
    ComputerHistoryState,
    | 'enabled'
    | 'capture'
    | 'accessibilityTrusted'
    | 'reason'
    | 'collector'
    | 'companion'
  > {
    const manager = this.manager()
    const snapshot = manager?.snapshot()
    return {
      enabled: this.enabled,
      capture: !this.enabled
        ? 'stopped'
        : snapshot?.state?.state ?? 'degraded',
      accessibilityTrusted:
        snapshot?.state?.accessibilityTrusted ?? false,
      ...(
        snapshot?.state?.reason
          ? { reason: snapshot.state.reason }
          // Ownership, not the existence of a manager object. A manager is created by a start attempt and by
          // `recover()`, so its presence says nothing about whether this Host holds capture - and testing for it
          // suppressed this very reason. Measured 2026-10-06 on the Windows machine: the state read
          // `capture: degraded` with no reason at all, while the Host knew it did not own capture.
          : this.enabled && !this.ownsCapture()
            ? { reason: 'capture-owned-by-another-host' }
            // Capture can be running, trusted and handshaken while the policy allows nothing at all: the initial
            // policy is include-only and carries only the built-in protections, so a Host whose first-run consent
            // never ran reports `running` and stores nothing. Measured 2026-10-06 on the owner's machine and
            // reproduced in an isolated Host: capture=running, collector={0.1.0, arm64}, refusedByReason={},
            // store 0|0. A paused capture is a separate, already-named state, so it is left alone here.
            : this.enabled
                && snapshot?.state?.state !== 'paused'
                && !this.policy().rules.some(rule => rule.action === 'allow' && rule.dimension === 'app')
              ? { reason: 'no-apps-allowed' }
            // Owning capture without a state yet means the collector has been started and has not answered.
            // The manager is right not to claim a state it has not seen, but the Host reporting `degraded` with
            // nothing else is the silence this product keeps being measured on; the wait itself is a fact.
            : this.enabled && snapshot?.state === undefined
              ? { reason: 'collector-starting' }
              : {}
      ),
      ...(snapshot?.hello
        ? {
            collector: {
              version: snapshot.hello.collectorVersion,
              arch: snapshot.hello.arch,
            },
          }
        : {}),
      companion: this.companion(),
    }
  }
}

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const enabled = config.enabled ?? false
  const dataDirectory = resolveHistoryDataDirectory(config)
  const history = openHistoryDatabase({ dataDirectory })

  const policies = new PolicyStore(history.db)
  const policyNow = Date.now()
  const initialPolicy = policies.ensureInitial(policyNow)
  if (initialPolicy.mode !== 'include-only') {
    policies.replace(
      'include-only',
      initialPolicy.rules,
      policyNow,
    )
  }
  const episodes = new EpisodeStore(history.db)
  const deletion = new DeletionService(history.db)
  const retention = new RetentionService(history.db)
  retention.sweep(Date.now())

  const retentionSettings = new RetentionSettingsStore(history.db)
  const ingestion = new IngestionService(
    history.db,
    new DshWorkspaceResolver(ctx),
    () => policies.get(),
    undefined,
    () => retentionSettings.observationRetentionMs(),
    () => retentionSettings.episodeRetentionMs(),
  )

  let retentionMaintenanceFailureAtMs: number | undefined
  const retentionTimer = setInterval(
    () => {
      try {
        retention.sweep(Date.now())
        ingestion.reseed()
        retentionMaintenanceFailureAtMs = undefined
      } catch {
        // Ambient maintenance must never crash the DSH Host, but retention is a privacy promise: a failed sweep
        // cannot disappear. Keep the failure visible until a later maintenance cycle completes successfully.
        retentionMaintenanceFailureAtMs = Date.now()
      }
    },
    15 * 60 * 1000,
  )
  retentionTimer.unref()
  ctx.effect(
    () => () => { clearInterval(retentionTimer) },
  )

  const captureLockPath = path.join(
    dataDirectory,
    'capture-owner',
  )
  let captureLock:
    CaptureOwnershipLock | undefined
  let ownsCapture = false
  let manager: CollectorManager | undefined
  let recovery: Promise<void> | undefined

  const collectorExecutable =
    config.collectorExecutable
    ?? fileURLToPath(
      new URL(
        '../bin/dsh-computer-history-collector',
        import.meta.url,
      ),
    )

  /** `true` once in-flight ingestion settles, `false` if it does not. */
  const ingestedIdle = async (): Promise<boolean> => {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        ingestion.whenIdle().then(() => true),
        new Promise<false>(resolve => {
          timer = setTimeout(() => resolve(false), 15_000)
          timer.unref()
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  const releaseCurrentCaptureLock = async (): Promise<void> => {
    ownsCapture = false
    const lock = captureLock
    captureLock = undefined
    if (!lock) return
    try {
      await lock.release()
    } catch {
      // Ownership release is idempotent; disposal/recovery continues.
    }
  }

  const ensureManager = (): CollectorManager => {
    if (manager) return manager
    manager = new CollectorManager(ctx, {
      executable: collectorExecutable,
      cwd: dataDirectory,
      restartOnCrash: config.collectorRestart ?? true,
      onMessage: async (message: CollectorToHost) => {
        if (message.type === 'hello') {
          await manager?.initialize(policies.get())
        }
        if (message.type === 'observation') {
          await ingestion.ingest(message)
        }
      },
      // This callback must release the *current* lock, not the lock from the
      // first launch. A manual recovery can acquire a new lock on the same
      // manager instance after the crash budget is exhausted.
      onUnexpectedExit: releaseCurrentCaptureLock,
    })
    return manager
  }

  const acquireCaptureOwnership = async (): Promise<boolean> => {
    if (ownsCapture && captureLock) return true
    const lock = await CaptureOwnershipLock.tryAcquire(
      captureLockPath,
      config.captureLockProbeWaitMs
        ?? CAPTURE_LOCK_PROBE_WAIT_MS,
    )
    if (!lock) return false
    captureLock = lock
    ownsCapture = true
    return true
  }

  const releaseCaptureOwnership = async (): Promise<void> => {
    try {
      await manager?.stop('plugin-dispose')
    } catch {
      // A failed stop still releases ownership in its own body.
    }
    await releaseCurrentCaptureLock()
  }

  const recoverCapture = async (): Promise<void> => {
    if (!enabled) {
      throw new Error('computer history capture is disabled')
    }
    if (recovery) return recovery

    recovery = (async () => {
      if (!await acquireCaptureOwnership()) {
        throw new Error(
          'computer history capture is owned by another DSH Host',
        )
      }

      const activeManager = ensureManager()
      const state = activeManager.snapshot().state?.state
      if (
        state === 'running'
        || state === 'paused'
        || state === 'permission-required'
      ) {
        return
      }

      try {
        await activeManager.recover()
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        // A concurrently-running helper still needs this Host's lock. Every
        // other failed recovery path — including a shutdown still draining —
        // must hand a newly-acquired lock back so the next retry or another
        // Host cannot be wedged out.
        if (message !== 'collector is already running') {
          await releaseCurrentCaptureLock()
        }
        throw error
      }
    })().finally(() => {
      recovery = undefined
    })
    return recovery
  }

  if (enabled && await acquireCaptureOwnership()) {
    try {
      ensureManager().start()
    } catch (error) {
      await releaseCurrentCaptureLock()
      throw error
    }
  }

  const acquirePolicyChangeLease =
    async (): Promise<() => Promise<void>> => {
      if (ownsCapture) {
        if (!captureLock) {
          throw new Error(
            'capture ownership invariant violated',
          )
        }
        return captureLock.acquireLease()
      }

      // A policy mutation from a non-owner must not disturb the live
      // owner's capture. Probe with zero wait: if the lock is held at
      // all, another DSH Host is mid-mutation or owns capture.
      const probe = await CaptureOwnershipLock.tryAcquire(
        captureLockPath,
        0,
      )
      if (!probe) {
        throw new Error(
          'capture policy is owned by another DSH Host',
        )
      }
      return async () => { await probe.release() }
    }

  // Browser companion intake (ADR 0007). It cannot live on the DSH webserver:
  // those routes sit behind a session auth an extension cannot present, so the
  // plugin owns a loopback listener with its own pairing token.
  const companionTokens = new CompanionTokenStore(history.db)
  const companionIntake = new CompanionIntake({
    tokens: companionTokens,
    ...(config.companionPort === undefined
      ? {}
      : { port: config.companionPort }),
    deliver: async (payload) => {
      // Pause means nothing new is recorded — for the companion exactly as for
      // the Accessibility collector.
      const snapshot = manager?.snapshot().state
      if (!enabled) {
        ingestion.noteRefusal('capture-disabled')
        return { stored: false, reason: 'capture-disabled' as const }
      }
      if (!ownsCapture) {
        ingestion.noteRefusal('capture-not-owned')
        return { stored: false, reason: 'capture-not-owned' as const }
      }
      if (snapshot?.state !== 'running') {
        const reason = snapshot?.state === 'paused' ? 'capture-paused' as const : 'collector-not-running' as const
        ingestion.noteRefusal(reason)
        return { stored: false, reason }
      }
      return { stored: await ingestion.ingest(companionObservation(payload)) }
    },
  })
  const browserPaired = companionTokens.state('browser').paired
  const editorPaired = companionTokens.state('editor').paired
  let companionState: NonNullable<
    ComputerHistoryState['companion']
  > = {
    listening: false,
    paired: browserPaired,
    editorPaired,
    reason: 'companion intake not started',
  }
  const companionStarted = companionIntake.start()
    .then((port) => {
      companionState = { listening: true, port, paired: browserPaired, editorPaired }
    })
    .catch((error: unknown) => {
      companionState = {
        listening: false,
        paired: browserPaired,
        editorPaired,
        reason: error instanceof Error
          ? error.message
          : 'companion intake failed',
      }
    })
  let companionStopPromise: Promise<void> | undefined
  const stopCompanion = (): Promise<void> => {
    companionStopPromise ??= (async () => {
      // start() is deliberately non-fatal, but teardown must not race a listener
      // that is still binding: wait for either listen or the recorded bind error
      // before asking it to stop.
      await companionStarted
      await companionIntake.stop()
    })()
    return companionStopPromise
  }
  // Registered early so a later setup failure still closes the loopback listener.
  // The database-owning teardown below awaits the same idempotent promise before
  // it can close SQLite, so Cordis may dispose effects concurrently without
  // letting an in-flight companion request outlive the database.
  ctx.effect(() => async () => {
    await stopCompanion()
  })

  const backend = new LocalComputerHistoryBackend(
    episodes,
    policies,
    deletion,
    new ManagedCapture(
      () => manager,
      enabled,
      () => ownsCapture,
      recoverCapture,
      () => policies.get(),
      () => {
        const browserPairing = companionTokens.state('browser')
        const editorPairing = companionTokens.state('editor')
        const browserSeen = companionIntake.lastSeen('browser')
        const editorSeen = companionIntake.lastSeen('editor')
        const validBrowserSeen = browserSeen !== undefined
          && browserSeen >= (browserPairing.createdAtMs ?? 0)
            ? browserSeen
            : undefined
        const validEditorSeen = editorSeen !== undefined
          && editorSeen >= (editorPairing.createdAtMs ?? 0)
            ? editorSeen
            : undefined
        const seen = [validBrowserSeen, validEditorSeen]
          .filter((value): value is number => value !== undefined)
        return {
          ...companionState,
          paired: browserPairing.paired,
          editorPaired: editorPairing.paired,
          ...(seen.length === 0 ? {} : { lastSeenAtMs: Math.max(...seen) }),
          ...(validBrowserSeen === undefined ? {} : { browserLastSeenAtMs: validBrowserSeen }),
          ...(validEditorSeen === undefined ? {} : { editorLastSeenAtMs: validEditorSeen }),
        }
      },
    ),
    {
      ...retentionSettings.get(),
      autoResume: config.autoResume ?? false,
      acquirePolicyChangeLease,
      ...(manager
        ? {
            onPolicyChanged: async policy => {
              if (
                ownsCapture
                && manager?.canConfigure()
              ) {
                await manager.applyPolicy(policy)
              }
            },
          }
        : {}),
      onHistoryChanged: () => { ingestion.reseed() },
    },
     companionTokens,
    new SemanticOptInStore(history.db),
    history.db,
    // Why observations were refused, so the panel can say "nothing is allowed yet,
    // and 12 observations have been refused because of it" rather than a bare count.
    () => ingestion.refusalCounts(),
    // Read at startup and handed over as data: the panel must not carry its own copy of
    // the adapter table, or the two would disagree the first time an adapter is added.
    () => {
      const preset = readFirstRunPreset()
      if (!preset) return undefined
      return {
        bundles: presetBundles(preset, process.platform),
        title: { ...preset.title },
        description: { ...preset.description },
      }
    },
    () => {
      const release = runningRelease()
      if (!release) return undefined
      // The profile may have been rebuilt away from this copy. That is a fact, not a guess: it is decided by
      // the digest pnpm recorded for the artifact against the artifact on disk, so a pnpm-linked install -
      // where timestamps say nothing - cannot make it cry wolf.
      const stale = findStaleInstall(release.loadedFrom, dshHomePath('profiles'))
      return stale ? { ...release, stale } : release
    },
    () => ({
      retention: retentionMaintenanceFailureAtMs === undefined ? 'ok' : 'failed',
      ...(retentionMaintenanceFailureAtMs === undefined
        ? {}
        : { lastFailureAtMs: retentionMaintenanceFailureAtMs }),
    }),
  )

  // Teardown is registered immediately, before anything that can throw,
  // so a failure while wiring the rest of the plugin still hands capture
  // ownership back. Cordis disposes effects registered before a throw
  // (concurrently, in reverse registration order), so relying on an
  // effect registered later would leak the lock file held by a live PID
  // and leave the helper running. Ordering *within* this single effect
  // is what is load-bearing:
  //   1. stop the companion listener so no new loopback request can enter;
  //   2. stop the helper, which bounds its exit and hands capture ownership back;
  //   3. quiesce in-flight backend operations;
  //   4. wait for any in-flight ingestion write to settle;
  //   5. close the database last.
  // Steps run concurrently *across* effects, so this must stay one
  // effect: a separate close effect could close the database while the
  // helper is still draining.
  ctx.effect(() => async () => {
    // Stop accepting companion work first, and wait for the listener's active
    // requests to be torn down before SQLite can close. The separate early
    // effect above calls the same promise, so concurrent Cordis disposal is safe.
    await stopCompanion()

    // Every step runs even if an earlier one throws.
    await releaseCaptureOwnership()
    try {
      await backend.drain()
    } catch {
      // Quiescing is best-effort: the database still closes below.
    }

    // Ingestion writes are not part of the backend's operation tracker,
    // and closing the database during an open transaction silently
    // discards that write. Wait for in-flight ingestion, and if it will
    // not settle, leave the database open: leaking a handle at process
    // exit is strictly better than losing an observation.
    if (!await ingestedIdle()) return
    try {
      history.close()
    } catch {
      // Closing is the last step; nothing remains to recover.
    }
  }, 'computer-history: teardown')

  try {
    await ctx.plugin(ComputerHistoryService, { backend })
    registerHistoryApi(ctx)
  } catch (error) {
    // Roll back the capture ownership acquired above: this apply() is
    // failing, so no teardown will run for a lock this call still holds.
    await releaseCaptureOwnership()
    throw error
  }

  ctx.effect(
    () => registerAgentIntegration(ctx, config.autoResume ?? false),
    'computer-history: agent integration',
  )
}
