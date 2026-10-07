import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import '@deepseek-ai/dsh-system-prompt'
import { computerHistoryService } from '../host/service/index.js'
import { buildAgentResumeHandoffFromEpisode } from './handoff.js'
import {
  buildContinuationBootstrap,
  renderContinuationBootstrap,
} from './continuation-bootstrap.js'

const CONTINUE_TOOL_NAME = 'computer_history_continue'
const BOOTSTRAP_SCHEMA_PREFIX = [
  'Automatic Computer History Continue attachment for this turn.',
  'This bounded work state is already available before any tool call; use it to start the continuation.',
  'Call this tool only when deeper history/evidence is needed.',
].join(' ')

function attachBootstrapToContinueTool(
  assembly: {
    tools: Array<{
      name: string
      description: string
      parameters: unknown
      deferLoading?: boolean
    }>
  },
  text: string,
): boolean {
  const index = assembly.tools.findIndex(tool =>
    tool.name === CONTINUE_TOOL_NAME,
  )
  if (index < 0) return false
  const tool = assembly.tools[index]
  if (!tool) return false
  assembly.tools[index] = {
    name: tool.name,
    parameters: tool.parameters,
    ...(tool.deferLoading === undefined
      ? {}
      : { deferLoading: tool.deferLoading }),
    description: [
      tool.description,
      '',
      BOOTSTRAP_SCHEMA_PREFIX,
      text,
    ].join('\n'),
  }
  return true
}

/**
 * A real Continue capsule deterministically contributes one bounded, frozen
 * bootstrap through the already-visible computer_history_continue tool schema.
 * Complete DSH personas may lock the system-prompt section set, but tool schemas
 * remain authoritative request input. No work state lives in the capsule or
 * transcript; the current binding is resolved at first assembly.
 */
export function registerComputerHistoryContinueRouting(
  ctx: Context,
  agent: Agent,
): () => void {
  const scoped = agent.ctx
  let continuationTurn: number | undefined
  let bootstrapText: string | undefined
  let bootstrapPromise: Promise<string> | undefined
  let episodeId: ReturnType<ReturnType<typeof computerHistoryService>['continuationEpisodeForSession']>

  const currentOpenTurn = (): number | undefined => {
    const boundary = agent.session.snapshotEvents().findLast(event =>
      event.type === 'turn/start' || event.type === 'turn/end',
    )
    return boundary?.type === 'turn/start'
      ? boundary.data.turn
      : undefined
  }

  const resolveBinding = () => {
    if (episodeId !== undefined) return episodeId
    try {
      episodeId = computerHistoryService(ctx).continuationEpisodeForSession(
        String(agent.session.id),
      )
    } catch {
      episodeId = undefined
    }
    return episodeId
  }

  const resolveBootstrap = (
    boundEpisodeId: NonNullable<typeof episodeId>,
    signal: AbortSignal | undefined,
  ): Promise<string> => {
    if (bootstrapText !== undefined) return Promise.resolve(bootstrapText)
    if (bootstrapPromise !== undefined) return bootstrapPromise
    bootstrapPromise = (async () => {
      try {
        const handoff = await buildAgentResumeHandoffFromEpisode(
          ctx,
          boundEpisodeId,
          signal,
        )
        const bootstrap = await buildContinuationBootstrap(
          ctx,
          handoff,
          signal,
        )
        return bootstrap
          ? renderContinuationBootstrap(bootstrap)
          : [
              '## Computer History Continue',
              '',
              'The user explicitly selected Continue, but no bounded Computer History work state is available.',
              'Do not invent historical state. Inspect the current authoritative workspace or URL and ask only if the task itself cannot be recovered.',
            ].join('\n')
      } catch {
        return [
          '## Computer History Continue',
          '',
          'The user explicitly selected Continue, but the bounded Computer History bootstrap could not be resolved.',
          'Do not invent historical state. Inspect the current authoritative workspace or URL and ask only if the task itself cannot be recovered.',
        ].join('\n')
      }
    })().then(text => {
      bootstrapText = text
      return text
    })
    return bootstrapPromise
  }

  const assembled = scoped.on(
    'system-prompt/assemble',
    async (assembly, context, next) => {
      const boundEpisodeId = resolveBinding()
      const turn = currentOpenTurn()
      if (boundEpisodeId === undefined || turn === undefined) return next()

      if (continuationTurn === undefined) continuationTurn = turn
      if (turn !== continuationTurn) return next()

      attachBootstrapToContinueTool(
        assembly,
        await resolveBootstrap(boundEpisodeId, context.signal),
      )
      return next()
    },
  )

  const consumeBinding = (turn: number): void => {
    if (continuationTurn === undefined || turn !== continuationTurn) return
    try {
      computerHistoryService(ctx).unbindContinuationSession(
        String(agent.session.id),
      )
    } catch {
      // A failed cleanup may leave an expiring local binding, but must not
      // fail the user's completed/failed model turn.
    }
    episodeId = undefined
    continuationTurn = undefined
    bootstrapText = undefined
    bootstrapPromise = undefined
  }

  const stopping = scoped.on(
    'agent/turn-stopping',
    payload => {
      if (payload.agent === agent) consumeBinding(payload.turn)
    },
  )
  const error = scoped.on(
    'agent/error',
    payload => {
      if (payload.agent === agent) consumeBinding(payload.turn)
    },
  )

  return () => {
    error()
    stopping()
    assembled()
  }
}
