import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
import { CollectorManager } from './collector/index.js'
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
}

class ManagedCapture implements CaptureController {
  public constructor(
    private readonly manager: CollectorManager | undefined,
    private readonly enabled: boolean,
  ) {}

  public pause(): Promise<void> {
    return this.manager?.pause() ?? Promise.resolve()
  }
  public resume(): Promise<void> {
    return this.manager?.resume() ?? Promise.resolve()
  }
  public getState(): Pick<
    ComputerHistoryState,
    'enabled' | 'capture' | 'accessibilityTrusted' | 'collector'
  > {
    const snapshot = this.manager?.snapshot()
    return {
      enabled: this.enabled,
      capture: !this.enabled
        ? 'stopped'
        : snapshot?.state?.state ?? 'degraded',
      accessibilityTrusted:
        snapshot?.state?.accessibilityTrusted ?? false,
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
  const dataDirectory = config.dataDirectory
    ?? path.resolve(process.cwd(), '.data/computer-history')
  const history = openHistoryDatabase({ dataDirectory })
  ctx.effect(() => () => history.close())

  const policies = new PolicyStore(history.db)
  policies.ensureInitial(Date.now())
  const episodes = new EpisodeStore(history.db)
  const deletion = new DeletionService(history.db)
  const retention = new RetentionService(history.db)
  retention.sweep(Date.now())
  const retentionTimer = setInterval(
    () => { retention.sweep(Date.now()) },
    60 * 60 * 1000,
  )
  retentionTimer.unref()
  ctx.effect(() => () => { clearInterval(retentionTimer) })

  const ingestion = new IngestionService(
    history.db,
    new DshWorkspaceResolver(ctx),
    () => policies.get(),
  )

  let manager: CollectorManager | undefined
  if (enabled) {
    const collectorExecutable = config.collectorExecutable
      ?? fileURLToPath(
        new URL('../bin/dsh-computer-history-collector', import.meta.url),
      )
    manager = new CollectorManager(ctx, {
      executable: collectorExecutable,
      cwd: dataDirectory,
      onMessage: async (message: CollectorToHost) => {
        if (message.type === 'hello') manager?.configure(policies.get())
        if (message.type === 'observation') await ingestion.ingest(message)
        if (message.type === 'fatal') {
          throw new Error('collector fatal: ' + message.code)
        }
      },
    })
    manager.start()
    const owned = manager
    ctx.effect(() => () => owned.stop('plugin-dispose'))
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
      ...(manager ? { onPolicyChanged: policy => manager?.configure(policy) } : {}),
    },
  )

  await ctx.plugin(ComputerHistoryService, { backend })
  registerHistoryApi(ctx)
  ctx.effect(
    () => registerAgentIntegration(ctx, config.autoResume ?? false),
    'computer-history: agent integration',
  )
}
