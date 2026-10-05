import type {
  AccessibilitySettingsCapability,
  AccessibilitySettingsOpenResult,
  BrowserCompanionSetup,
  ComputerHistoryState,
  DeleteHistoryRequest,
  DeleteHistoryResult,
  EditorCompanionInstallCapability,
  HistoryExport,
  EditorCompanionInstallResult,
  EpisodeDetail,
  EpisodeSummary,
  MinimisedSummaryPayload,
  PairingRotation,
  PolicySnapshot,
  PolicyUpdate,
  ResumeOpenCapability,
  ResumeOpenRequest,
  ResumeOpenResult,
  ResumeResolution,
  RetentionSettings,
  SemanticSummaryState,
  SupportedApplicationInventory,
  TimelineDay,
  WorkThread,
  WorkThreadDetail,
} from '../shared/index.js'
import { historyApiPath, type HistoryApiSuffix } from './api-route.js'

async function requestResponse(
  path: HistoryApiSuffix,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(historyApiPath(path), {
    credentials: 'same-origin',
    ...init,
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Computer History request failed (${response.status})`)
  }
  return response
}

async function requestJson<T>(
  path: HistoryApiSuffix,
  init?: RequestInit,
): Promise<T> {
  const response = await requestResponse(path, init)
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

export interface PreparedDownloadRoute {
  readonly href: string
  readonly filename?: string
}

function downloadFilename(response: Response): string | undefined {
  const disposition = response.headers.get('content-disposition') ?? ''
  const match = /(?:^|;)\s*filename="([^"]+)"/i.exec(disposition)
  const filename = match?.[1]
  if (!filename || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(filename)) {
    return undefined
  }
  return filename
}

export const historyApi = {
  prepareDownloadRoute: async (path: HistoryApiSuffix): Promise<PreparedDownloadRoute> => {
    const response = await requestResponse(path, { method: 'HEAD' })
    const filename = downloadFilename(response)
    return {
      href: historyApiPath(path),
      ...(filename === undefined ? {} : { filename }),
    }
  },
  getState: (): Promise<ComputerHistoryState> =>
    requestJson('/state'),
  getAccessibilitySettingsCapability: (): Promise<AccessibilitySettingsCapability> =>
    requestJson('/system/accessibility'),
  openAccessibilitySettings: (): Promise<AccessibilitySettingsOpenResult> =>
    postJson('/system/accessibility'),
  getSupportedApplications: (): Promise<SupportedApplicationInventory> =>
    requestJson('/system/applications'),
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
  getThread: (threadKey: string): Promise<WorkThreadDetail> =>
    requestJson(`/thread?threadKey=${encodeURIComponent(threadKey)}`),
  getSemanticState: (): Promise<SemanticSummaryState> =>
    requestJson('/semantic'),
  getEpisode: (id: string): Promise<EpisodeDetail> =>
    requestJson(`/episode?id=${encodeURIComponent(id)}`),
  pause: (): Promise<ComputerHistoryState> =>
    postJson('/pause'),
  resume: (): Promise<ComputerHistoryState> =>
    postJson('/resume'),
  recover: (): Promise<ComputerHistoryState> =>
    postJson('/recover'),
  replacePolicy: (update: PolicyUpdate): Promise<PolicySnapshot> =>
    postJson('/policy', update),
  setRetention: (input: {
    readonly observationRetentionHours: number
    readonly episodeRetentionDays: number
  }): Promise<RetentionSettings> =>
    postJson('/retention', input),
  deleteHistory: (request: DeleteHistoryRequest): Promise<DeleteHistoryResult> =>
    postJson('/delete', request),
  exportHistory: (): Promise<HistoryExport> =>
    requestJson('/export'),
  importHistory: (document: unknown): Promise<{ readonly imported: Record<string, number> }> =>
    postJson('/import', document),
  rotatePairing: (): Promise<PairingRotation> =>
    postJson('/pairing/rotate'),
  getCompanionSetup: (): Promise<BrowserCompanionSetup> =>
    requestJson('/companion/setup'),
  getEditorCompanionInstallCapability: (): Promise<EditorCompanionInstallCapability> =>
    requestJson('/companion/editor'),
  installEditorCompanion: (): Promise<EditorCompanionInstallResult> =>
    postJson('/companion/editor'),
  resolveResume: (query: string): Promise<ResumeResolution> =>
    postJson('/resume-hint', {
      query,
      nowMs: Date.now(),
      turn: 1,
    }),
  getResumeOpenCapability: (): Promise<ResumeOpenCapability> =>
    requestJson('/resume/open'),
  openResume: (request: ResumeOpenRequest): Promise<ResumeOpenResult> =>
    postJson('/resume/open', request),
  previewSemantic: (scopeKey: string): Promise<MinimisedSummaryPayload> =>
    requestJson(`/semantic/preview?scope=${encodeURIComponent(scopeKey)}`),
  revokeSemantic: (scopeKey: string): Promise<{
    readonly revoked: boolean
    readonly purged: number
    readonly forgotten: number
  }> =>
    postJson('/semantic/revoke', { scopeKey }),
} as const
