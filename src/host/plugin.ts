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
  runningRelease,
  type CollectorToHost,
  type ComputerHistoryState,
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

class ManagedCapture implements CaptureController {
  public constructor(
    private readonly manager: CollectorManager | undefined,
    private readonly enabled: boolean,
    private readonly ownsCapture: () => boolean,
    private readonly companion: () => NonNullable<
      ComputerHistoryState['companion']
    > = () => ({ listening: false, paired: false }),
  ) {}

  private requireOwnedManager(): CollectorManager {
    if (!this.enabled) {
      throw new Error('computer history capture is disabled')
    }
    if (!this.manager) {
      throw new Error(
        'computer history capture is owned by another DSH Host',
      )
    }
    if (!this.ownsCapture()) {
      throw new Error(
        'computer history capture is unavailable on this DSH Host',
      )
    }
    return this.manager
  }

  public async pause(): Promise<void> {
    await this.requireOwnedManager().pause()
  }

  public async resume(): Promise<void> {
    await this.requireOwnedManager().resume()
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
    const snapshot = this.manager?.snapshot()
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
          : this.enabled && !this.manager
            ? { reason: 'capture-owned-by-another-host' }
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
  )

  const retentionTimer = setInterval(
    () => {
      try {
        retention.sweep(Date.now())
        ingestion.reseed()
      } catch {
        // Ambient maintenance must never crash the DSH Host.
        // The next scheduled sweep or explicit mutation retries.
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
  let ownedCapture:
    | {
        readonly manager: CollectorManager
        readonly lock: CaptureOwnershipLock
      }
    | undefined

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

  const releaseCaptureOwnership = async (): Promise<void> => {
    if (!ownedCapture) return
    try {
      await ownedCapture.manager.stop('plugin-dispose')
    } catch {
      // A failed stop still releases ownership in its own body.
    }
    ownsCapture = false
    try {
      await ownedCapture.lock.release()
    } catch {
      // Ownership release is idempotent; disposal continues.
    }
  }

  if (enabled) {
    // Bounded probe rather than a zero-wait acquire: an outgoing owner
    // hands the lock back asynchronously, and losing that race would
    // wrongly downgrade this Host to a read-only client. A genuinely
    // long-lived owner still wins and this Host stays read/delete only.
    captureLock = await CaptureOwnershipLock.tryAcquire(
      captureLockPath,
      config.captureLockProbeWaitMs
        ?? CAPTURE_LOCK_PROBE_WAIT_MS,
    )
    ownsCapture = captureLock !== undefined

    if (captureLock) {
      const collectorExecutable =
        config.collectorExecutable
        ?? fileURLToPath(
          new URL(
            '../bin/dsh-computer-history-collector',
            import.meta.url,
          ),
        )

      try {
        const ownedLock = captureLock
        manager = new CollectorManager(ctx, {
          executable: collectorExecutable,
          cwd: dataDirectory,
          restartOnCrash: config.collectorRestart ?? true,
          onMessage: async (
            message: CollectorToHost,
          ) => {
            if (message.type === 'hello') {
              await manager?.initialize(policies.get())
            }
            if (message.type === 'observation') {
              await ingestion.ingest(message)
            }
          },
          onUnexpectedExit: async () => {
            ownsCapture = false
            await ownedLock.release()
          },
        })
        manager.start()
      } catch (error) {
        ownsCapture = false
        await captureLock.release()
        captureLock = undefined
        throw error
      }

      ownedCapture = {
        manager,
        lock: captureLock,
      }
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
      if (!enabled || !ownsCapture || snapshot?.state !== 'running') {
        return false
      }
      return ingestion.ingest(companionObservation(payload))
    },
  })
  // Read the pairing state once, synchronously: the listener's callbacks run
  // later, possibly after the store is closed during disposal, and a database
  // read there would reject with "database is not open" while nobody is left
  // to handle it.
  const paired = companionTokens.state().paired
  let companionState: NonNullable<
    ComputerHistoryState['companion']
  > = {
    listening: false,
    paired,
    reason: 'companion intake not started',
  }
  void companionIntake.start()
    .then((port) => {
      companionState = { listening: true, port, paired }
    })
    .catch((error: unknown) => {
      companionState = {
        listening: false,
        paired,
        reason: error instanceof Error
          ? error.message
          : 'companion intake failed',
      }
    })
  ctx.effect(() => async () => {
    await companionIntake.stop()
  })

  const backend = new LocalComputerHistoryBackend(
    episodes,
    policies,
    deletion,
    new ManagedCapture(
      manager,
      enabled,
      () => ownsCapture,
      () => ({
        ...companionState,
        // Read per call, from memory: the reason `paired` is snapshotted is that a
        // listener callback can run after the store is closed.
        lastSeenAtMs: companionIntake.lastSeen(),
      }),
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
        bundles: presetBundles(preset),
        title: { ...preset.title },
        description: { ...preset.description },
      }
    },
    () => {
      // No drift guess here: pnpm hard-links installed files out of its content-addressed store, so the
      // installed copy carries the store entry's timestamp and looks older than the artifact by construction.
      // The owner's own install showed the banner crying wolf; the plugin states facts instead.
      return runningRelease()
    },
  )

  // Teardown is registered immediately, before anything that can throw,
  // so a failure while wiring the rest of the plugin still hands capture
  // ownership back. Cordis disposes effects registered before a throw
  // (concurrently, in reverse registration order), so relying on an
  // effect registered later would leak the lock file held by a live PID
  // and leave the helper running. Ordering *within* this single effect
  // is what is load-bearing:
  //   1. stop the helper, which bounds its exit and hands capture
  //      ownership back before it returns;
  //   2. quiesce in-flight backend operations;
  //   3. wait for any in-flight ingestion write to settle;
  //   4. close the database last.
  // Steps run concurrently *across* effects, so this must stay one
  // effect: a separate close effect could close the database while the
  // helper is still draining.
  ctx.effect(() => async () => {
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
