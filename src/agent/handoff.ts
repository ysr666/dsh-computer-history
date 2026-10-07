import type { Context } from '@deepseek-ai/cordis'
import {
  attachDshCheckpoint,
  buildPriorThreadTail,
  buildUrlDetourBridge,
  buildResumeHandoff,
  buildResumeHandoffFromEpisode,
  enrichResumeHandoff,
} from '../host/resume/index.js'
import { computerHistoryService } from '../host/service/index.js'
import type {
  EpisodeId,
  EpisodeSummary,
  ResumeHandoff,
  ResumeResolution,
  ResumeThreadTail,
} from '../shared/index.js'


/**
 * Build the Agent-facing handoff from auditable history, then add only current
 * local metadata: Git shape and the last DSH turn boundary in the same
 * workspace before this external work began.
 */
export async function buildAgentResumeHandoff(
  ctx: Context,
  resolution: ResumeResolution,
): Promise<ResumeHandoff> {
  const withGit = await enrichResumeHandoff(
    ctx,
    buildResumeHandoff(resolution),
  )
  if (withGit.status !== 'hit') return withGit

  const checkpoint = computerHistoryService(ctx).latestDshCheckpoint({
    ...(withGit.workspace?.id
      ? { workspaceId: withGit.workspace.id }
      : {}),
    ...(withGit.workspace?.root
      ? { workspaceRoot: withGit.workspace.root }
      : {}),
    atOrBeforeMs: withGit.startedAtMs,
  })

  return attachDshCheckpoint(withGit, checkpoint)
}


export async function buildAgentResumeHandoffFromEpisode(
  ctx: Context,
  episodeId: EpisodeId,
  signal?: AbortSignal,
): Promise<ResumeHandoff> {
  const service = computerHistoryService(ctx)
  const episode = await service.getEpisode(episodeId, signal)
  if (episode === undefined) {
    return { status: 'none', reason: 'episode not found' }
  }

  const withGit = await enrichResumeHandoff(
    ctx,
    buildResumeHandoffFromEpisode(episode),
  )
  if (withGit.status !== 'hit') return withGit

  const checkpoint = service.latestDshCheckpoint({
    ...(withGit.workspace?.id ? { workspaceId: withGit.workspace.id } : {}),
    ...(withGit.workspace?.root ? { workspaceRoot: withGit.workspace.root } : {}),
    atOrBeforeMs: withGit.startedAtMs,
  })
  const withCheckpoint = attachDshCheckpoint(withGit, checkpoint)
  if (withCheckpoint.status !== 'hit' || !withCheckpoint.threadKey) {
    return withCheckpoint
  }

  let episodes: readonly EpisodeSummary[] = []
  let priorThreadTail: ResumeThreadTail | undefined
  try {
    const detail = await service.thread(
      { threadKey: withCheckpoint.threadKey },
      signal,
    )
    episodes = detail?.timeline.flatMap(day => day.episodes) ?? []
    priorThreadTail = buildPriorThreadTail(episodes, episode.id)
  } catch {
    // Thread context is helpful but cannot make an explicit Continue fail.
    return withCheckpoint
  }

  if (!priorThreadTail) return withCheckpoint

  let urlDetourBridge
  try {
    const surrounding = await service.recent({
      sinceMs: priorThreadTail.lastActiveAtMs,
      limit: 100,
    }, signal)
    urlDetourBridge = buildUrlDetourBridge(
      episodes,
      surrounding,
      episode.id,
    )
  } catch {
    // A failed surrounding-history lookup must not discard the valid thread tail.
  }

  return {
    ...withCheckpoint,
    priorThreadTail,
    ...(urlDetourBridge ? { urlDetourBridge } : {}),
  }
}
