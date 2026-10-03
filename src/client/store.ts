import type {
  ComputerHistoryState,
  DeleteHistoryRequest,
  DeleteHistoryResult,
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

type ControlApi = Pick<typeof historyApi,
  | 'getState'
  | 'getPolicy'
  | 'getRetention'
  | 'pause'
  | 'resume'
  | 'replacePolicy'
  | 'setRetention'
  | 'deleteHistory'
  | 'rotatePairing'
>
export interface HistoryControlStore {
  getSnapshot(): HistoryControlSnapshot
  subscribe(listener: () => void): () => void
  load(): Promise<void>
  reload(): Promise<void>
  pause(): Promise<ComputerHistoryState>
  resume(): Promise<ComputerHistoryState>
  replacePolicy(update: PolicyUpdate): Promise<PolicySnapshot>
  setRetention(input: {
    readonly observationRetentionHours: number
    readonly episodeRetentionDays: number
  }): Promise<RetentionSettings>
  deleteHistory(request: DeleteHistoryRequest): Promise<DeleteHistoryResult>
  rotatePairing(): Promise<PairingRotation>
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

  const publish = (next: HistoryControlSnapshot): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const readAll = async (): Promise<void> => {
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      publish({ ...snapshot, status: 'loading', error: undefined })
      try {
        const [state, policy, retention] = await Promise.all([
          api.getState(),
          api.getPolicy(),
          api.getRetention(),
        ])
        publish({
          ...snapshot,
          status: 'ready',
          state,
          policy,
          retention,
          error: undefined,
        })
      } catch (cause) {
        publish({
          ...snapshot,
          status: 'error',
          error: cause instanceof Error ? cause.message : String(cause),
        })
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
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async load() {
      if (snapshot.status === 'ready') return
      await readAll()
    },
    reload: readAll,
    async pause() {
      return foldState(await api.pause())
    },
    async resume() {
      return foldState(await api.resume())
    },
    async replacePolicy(update) {
      const policy = await api.replacePolicy(update)
      publish({ ...snapshot, status: 'ready', policy, error: undefined })
      return policy
    },
    async setRetention(input) {
      const retention = await api.setRetention(input)
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
      publish({
        ...snapshot,
        historyRevision: snapshot.historyRevision + 1,
      })
      return result
    },
    async rotatePairing() {
      const rotation = await api.rotatePairing()
      const state = snapshot.state
      if (state) {
        publish({
          ...snapshot,
          state: {
            ...state,
            companion: {
              listening: rotation.listening,
              paired: rotation.paired,
              ...(rotation.port === undefined ? {} : { port: rotation.port }),
            },
          },
        })
      }
      return rotation
    },
  }
}

