import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { registerExperimentalResumeHint } from './resume-hint.js'
import { registerComputerHistoryTools } from './tools.js'
import { registerDshCheckpoints } from './checkpoint.js'

export function registerAgentIntegration(
  ctx: Context,
  autoResume: boolean,
): () => void {
  const installed = new Map<Agent, () => void>()
  const install = (agent: Agent): void => {
    if (installed.has(agent)) return
    const disposers = [
      registerComputerHistoryTools(agent.ctx),
      registerDshCheckpoints(ctx, agent),
    ]
    installed.set(agent, () => {
      for (const dispose of disposers.toReversed()) dispose()
    })
  }

  for (const agent of ctx.agents.list()) install(agent)
  const created = ctx.on('agent/created', ({ agent }) => { install(agent) })
  const disposed = ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  const resume = autoResume
    ? registerExperimentalResumeHint(ctx)
    : () => {}

  return () => {
    resume()
    disposed()
    created()
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }
}
