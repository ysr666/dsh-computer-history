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
  EPISODE_RETENTION_MS,
  OBSERVATION_RETENTION_MS,
  type CollectorToHost,
  type ComputerHistoryState,
} from '../shared/index.js'
import { registerHistoryApi } from './api/index.js'
import {
  CaptureOwnershipLock,
  CollectorManager,
  isCaptureOwnershipContention,
} from './collector/index.js'
import { IngestionService } from './ingestion/index.js'
import { DeletionService, RetentionService } from './retention/index.js'
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
    return this.manager
  }

  public pause(): Promise<void> {
    return this.requireOwnedManager().pause()
  }

  public resume(): Promise<void> {
    return this.requireOwnedManager().resume()
  }
  public getState(): Pick<
    ComputerHistoryState,
    'enabled' | 'capture' | 'accessibilityTrusted' | 'reason' | 'collector'
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
    }
  }
}

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const enabled = config.enabled ?? false
  const dataDirectory = resolveHistoryDataDirectory(config)
  const history = openHistoryDatabase({ dataDirectory })
  ctx.effect(() => () => history.close())

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

  const ingestion = new IngestionService(
    history.db,
    new DshWorkspaceResolver(ctx),
    () => policies.get(),
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

  if (enabled) {
    try {
      captureLock =
        await CaptureOwnershipLock.acquire(
          captureLockPath,
        )
      ownsCapture = true
    } catch (error) {
      if (!isCaptureOwnershipContention(error)) {
        throw error
      }
      // Another DSH Host owns ambient capture. This
      // instance remains a read/delete client.
    }

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
              manager?.configure(policies.get())
            }
            if (message.type === 'observation') {
              await ingestion.ingest(message)
            }
            if (message.type === 'fatal') {
              throw new Error(
                'collector fatal: ' + message.code,
              )
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

      const ownedManager = manager
      const ownedLock = captureLock
      ctx.effect(() => async () => {
        await ownedManager.stop(
          'plugin-dispose',
        )
        ownsCapture = false
        await ownedLock.release()
      })
    }
  }

  const acquirePolicyChangeLease =
    async (): Promise<() => Promise<void>> => {
      if (ownsCapture) return async () => {}

      let probe: CaptureOwnershipLock
      try {
        probe =
          await CaptureOwnershipLock.acquire(
            captureLockPath,
          )
      } catch (error) {
        if (isCaptureOwnershipContention(error)) {
          throw new Error(
            'capture policy is owned by another DSH Host',
            { cause: error },
          )
        }
        throw error
      }
      return async () => { await probe.release() }
    }

  const backend = new LocalComputerHistoryBackend(
    episodes,
    policies,
    deletion,
    new ManagedCapture(manager, enabled),
    {
      observationRetentionHours:
        OBSERVATION_RETENTION_MS / 3_600_000,
      episodeRetentionDays:
        EPISODE_RETENTION_MS / 86_400_000,
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
  )

  await ctx.plugin(ComputerHistoryService, { backend })
  registerHistoryApi(ctx)
  ctx.effect(
    () => registerAgentIntegration(ctx, config.autoResume ?? false),
    'computer-history: agent integration',
  )
}
