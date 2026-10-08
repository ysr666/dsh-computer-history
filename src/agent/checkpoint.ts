import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { probeCheckpointGitHead } from '../host/resume/git-state.js'
import { computerHistoryService } from '../host/service/index.js'

/**
 * Record one metadata-only boundary when a top-level DSH turn is genuinely
 * about to close. Conversation text is deliberately not read or persisted.
 */
export function registerDshCheckpoints(
  ctx: Context,
  agent: Agent,
  now: () => number = Date.now,
): () => void {
  if (agent.session.header.origin === 'subagent') return () => {}

  return agent.ctx.on('agent/turn-stopping', async ({ turn }) => {
    const history = computerHistoryService(ctx)
    const state = history.getState()
    if (!state.enabled || state.capture !== 'running') return

    const cwd = agent.session.header.cwd
    if (!cwd || !path.isAbsolute(cwd)) return

    let workspace: {
      readonly id?: string
      readonly root?: string
      readonly title?: string
    } = {
      root: cwd,
      title: path.basename(cwd) || cwd,
    }

    try {
      const registered = await ctx.workspaceRegistry.resolveByPath(cwd)
      if (registered) {
        workspace = {
          id: String(registered.id),
          root: registered.path,
          title: registered.title,
        }
      }
    } catch {
      // The cwd remains a useful metadata-only continuity anchor.
    }

    const gitHead = await probeCheckpointGitHead(ctx, workspace.root ?? cwd)

    try {
      history.recordDshCheckpoint({
        sessionId: String(agent.session.id),
        turn,
        checkpointAtMs: now(),
        cwd,
        workspace,
        ...(gitHead === undefined ? {} : { gitHead }),
      })
    } catch {
      // Ambient continuity must never prevent a DSH turn from closing.
    }
  })
}
