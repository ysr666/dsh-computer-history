import type {
  ComputerHistoryState,
  DeleteHistoryRequest,
  DeleteHistoryResult,
  EditorCompanionInstallResult,
  PairingRotation,
  PolicySnapshot,
  PolicyUpdate,
  RetentionSettings,
} from '../shared/index.js'
import { historyApi } from './api.js'

export interface HistoryControlSnapshot {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly state?: ComputerHistoryState
  readonly policy?: PolicySnapshot
  readonly retention?: RetentionSettings
  readonly error?: string | undefined
  readonly historyRevision: number
}

const STATE_POLL_INTERVAL_MS = 2_000

type ControlApi = Pick<typeof historyApi,
  | 'getState'
  | 'getPolicy'
  | 'getRetention'
  | 'pause'
  | 'resume'
  | 'recover'
  | 'replacePolicy'
  | 'setRetention'
  | 'deleteHistory'
  | 'importHistory'
  | 'rotatePairing'
  | 'installEditorCompanion'
>
export interface HistoryControlStore {
  getSnapshot(): HistoryControlSnapshot
  subscribe(listener: () => void): () => void
  load(): Promise<void>
  reload(): Promise<void>
  refreshState(): Promise<ComputerHistoryState>
  pause(): Promise<ComputerHistoryState>
  resume(): Promise<ComputerHistoryState>
  recover(): Promise<ComputerHistoryState>
  replacePolicy(update: PolicyUpdate): Promise<PolicySnapshot>
  setRetention(input: {
    readonly observationRetentionHours: number
    readonly episodeRetentionDays: number
  }): Promise<RetentionSettings>
  deleteHistory(request: DeleteHistoryRequest): Promise<DeleteHistoryResult>
  importHistory(document: unknown): Promise<{ readonly imported: Record<string, number> }>
  rotatePairing(): Promise<PairingRotation>
  installEditorCompanion(): Promise<EditorCompanionInstallResult>
}

export function createHistoryControlStore(
  api: ControlApi = historyApi,
): HistoryControlStore {
  let snapshot: HistoryControlSnapshot = {
    status: 'idle',
    historyRevision: 0,
  }
  const listeners = new Set<() => void>()
  let loadPromise: Promise<void> | undefined
  let stateRefreshPromise: Promise<ComputerHistoryState> | undefined
  let statePollTimer: ReturnType<typeof setInterval> | undefined
  // A response that started before a successful write is historical evidence,
  // not current state. Network scheduling can return that old GET after the
  // mutation response, so keep one epoch for every state-changing operation.
  let mutationEpoch = 0

  const publish = (next: HistoryControlSnapshot): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const readAll = async (): Promise<void> => {
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      const startedAtEpoch = mutationEpoch
      publish({ ...snapshot, status: 'loading', error: undefined })
      try {
        const [state, policy, retention] = await Promise.all([
          api.getState(),
          api.getPolicy(),
          api.getRetention(),
        ])
        if (startedAtEpoch === mutationEpoch) {
          publish({
            ...snapshot,
            status: 'ready',
            state,
            policy,
            retention,
            error: undefined,
          })
        }
      } catch (cause) {
        if (startedAtEpoch === mutationEpoch) {
          publish({
            ...snapshot,
            status: 'error',
            error: cause instanceof Error ? cause.message : String(cause),
          })
        }
        throw cause
      } finally {
        loadPromise = undefined
      }
    })()
    return loadPromise
  }

  const foldState = (state: ComputerHistoryState): ComputerHistoryState => {
    publish({ ...snapshot, status: 'ready', state, error: undefined })
    return state
  }
  const refreshState = (): Promise<ComputerHistoryState> => {
    if (stateRefreshPromise) return stateRefreshPromise
    const startedAtEpoch = mutationEpoch
    stateRefreshPromise = api.getState()
      .then((state) => {
        if (startedAtEpoch === mutationEpoch) foldState(state)
        return state
      })
      .finally(() => { stateRefreshPromise = undefined })
    return stateRefreshPromise
  }
  const stopStatePolling = (): void => {
    if (statePollTimer === undefined) return
    clearInterval(statePollTimer)
    statePollTimer = undefined
  }
  const startStatePolling = (): void => {
    if (statePollTimer !== undefined) return
    statePollTimer = setInterval(() => {
      void refreshState().catch(() => undefined)
    }, STATE_POLL_INTERVAL_MS)
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) startStatePolling()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) stopStatePolling()
      }
    },
    async load() {
      if (snapshot.status === 'ready') return
      await readAll()
    },
    reload: readAll,
    refreshState,
    async pause() {
      const state = await api.pause()
      mutationEpoch += 1
      return foldState(state)
    },
    async resume() {
      const state = await api.resume()
      mutationEpoch += 1
      return foldState(state)
    },
    async recover() {
      const state = await api.recover()
      mutationEpoch += 1
      return foldState(state)
    },
    async replacePolicy(update) {
      const policy = await api.replacePolicy(update)
      mutationEpoch += 1
      publish({ ...snapshot, status: 'ready', policy, error: undefined })
      return policy
    },
    async setRetention(input) {
      const retention = await api.setRetention(input)
      mutationEpoch += 1
      const state = snapshot.state
        ? {
            ...snapshot.state,
            observationRetentionHours: retention.observationRetentionHours,
            episodeRetentionDays: retention.episodeRetentionDays,
          }
        : undefined
      publish({
        ...snapshot,
        status: 'ready',
        retention,
        ...(state === undefined ? {} : { state }),
        error: undefined,
      })
      return retention
    },
    async deleteHistory(request) {
      const result = await api.deleteHistory(request)
      mutationEpoch += 1
      publish({
        ...snapshot,
        status: 'ready',
        error: undefined,
        historyRevision: snapshot.historyRevision + 1,
      })
      return result
    },
    async importHistory(document) {
      const result = await api.importHistory(document)
      mutationEpoch += 1
      publish({
        ...snapshot,
        status: 'ready',
        error: undefined,
        historyRevision: snapshot.historyRevision + 1,
      })
      return result
    },
    async rotatePairing() {
      const rotation = await api.rotatePairing()
      mutationEpoch += 1
      const state = snapshot.state
      if (state) {
        const editorPaired = state.companion?.editorPaired
        const editorLastSeenAtMs = state.companion?.editorLastSeenAtMs
        publish({
          ...snapshot,
          status: 'ready',
          error: undefined,
          state: {
            ...state,
            companion: {
              listening: rotation.listening,
              paired: rotation.paired,
              ...(rotation.port === undefined ? {} : { port: rotation.port }),
              ...(editorPaired === undefined ? {} : { editorPaired }),
              ...(editorLastSeenAtMs === undefined
                ? {}
                : { editorLastSeenAtMs, lastSeenAtMs: editorLastSeenAtMs }),
            },
          },
        })
      } else {
        publish({ ...snapshot, status: 'ready', error: undefined })
      }
      return rotation
    },
    async installEditorCompanion() {
      const result = await api.installEditorCompanion()
      // Installation/configuration can rotate editor pairing and therefore
      // changes /state even though the route returns an install result rather
      // than ComputerHistoryState. Invalidate every older read before the UI
      // reloads, otherwise a pre-install poll can arrive last and restore
      // editorPaired=false.
      mutationEpoch += 1
      return result
    },
  }
}

