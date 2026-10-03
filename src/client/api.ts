import type {
  BrowserCompanionSetup,
  ComputerHistoryState,
  DeleteHistoryRequest,
  DeleteHistoryResult,
  EpisodeDetail,
  EpisodeSummary,
  MinimisedSummaryPayload,
  PairingRotation,
  PolicySnapshot,
  PolicyUpdate,
  ResumeResolution,
  RetentionSettings,
  SemanticSummaryState,
  TimelineDay,
  WorkThread,
} from '../shared/index.js'
import { historyApiPath, type HistoryApiSuffix } from './api-route.js'

async function requestJson<T>(
  path: HistoryApiSuffix,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(historyApiPath(path), {
    credentials: 'same-origin',
    ...init,
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Computer History request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}
function postJson<T>(
  path: HistoryApiSuffix,
  body?: unknown,
): Promise<T> {
  return requestJson<T>(path, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
  })
}

export const historyApi = {
  getState: (): Promise<ComputerHistoryState> =>
    requestJson('/state'),
  getPolicy: (): Promise<PolicySnapshot> =>
    requestJson('/policy'),
  getRetention: (): Promise<RetentionSettings> =>
    requestJson('/retention'),
  getTimeline: (days = 7): Promise<readonly TimelineDay[]> =>
    requestJson(`/timeline?days=${days}`),
  getRecent: (limit = 1): Promise<readonly EpisodeSummary[]> =>
    requestJson(`/recent?limit=${limit}`),
  getThreads: (limit = 20): Promise<readonly WorkThread[]> =>
    requestJson(`/threads?limit=${limit}`),
  getSemanticState: (): Promise<SemanticSummaryState> =>
    requestJson('/semantic'),
  getEpisode: (id: string): Promise<EpisodeDetail> =>
    requestJson(`/episode?id=${encodeURIComponent(id)}`),
  pause: (): Promise<ComputerHistoryState> =>
    postJson('/pause'),
  resume: (): Promise<ComputerHistoryState> =>
    postJson('/resume'),
  replacePolicy: (update: PolicyUpdate): Promise<PolicySnapshot> =>
    postJson('/policy', update),
  setRetention: (input: {
    readonly observationRetentionHours: number
    readonly episodeRetentionDays: number
  }): Promise<RetentionSettings> =>
    postJson('/retention', input),
  deleteHistory: (request: DeleteHistoryRequest): Promise<DeleteHistoryResult> =>
    postJson('/delete', request),
  rotatePairing: (): Promise<PairingRotation> =>
    postJson('/pairing/rotate'),
  getCompanionSetup: (): Promise<BrowserCompanionSetup> =>
    requestJson('/companion/setup'),
  resolveResume: (query: string): Promise<ResumeResolution> =>
    postJson('/resume-hint', {
      query,
      nowMs: Date.now(),
      turn: 1,
    }),
  previewSemantic: (scopeKey: string): Promise<MinimisedSummaryPayload> =>
    requestJson(`/semantic/preview?scope=${encodeURIComponent(scopeKey)}`),
  revokeSemantic: (scopeKey: string): Promise<{
    readonly revoked: boolean
    readonly purged: number
    readonly forgotten: number
  }> =>
    postJson('/semantic/revoke', { scopeKey }),
} as const
