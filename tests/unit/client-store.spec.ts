import { describe, expect, it, vi } from 'vitest'
import type {
  ComputerHistoryState,
  PolicySnapshot,
  RetentionSettings,
} from '../../src/shared/index.js'
import { createHistoryControlStore } from '../../src/client/store.js'

const readyState: ComputerHistoryState = {
  enabled: true,
  capture: 'running',
  accessibilityTrusted: true,
  observationRetentionHours: 24,
  episodeRetentionDays: 30,
  autoResume: false,
}
const readyPolicy: PolicySnapshot = {
  revision: 1,
  mode: 'include-only',
  rules: [],
  updatedAtMs: 1,
}
const readyRetention: RetentionSettings = {
  observationRetentionHours: 24,
  episodeRetentionDays: 30,
  updatedAtMs: 1,
}

function fakeControlApi() {
  return {
    getState: vi.fn().mockResolvedValue(readyState),
    getPolicy: vi.fn().mockResolvedValue(readyPolicy),
    getRetention: vi.fn().mockResolvedValue(readyRetention),
    pause: vi.fn().mockResolvedValue({ ...readyState, capture: 'paused' }),
    resume: vi.fn().mockResolvedValue(readyState),
    replacePolicy: vi.fn().mockResolvedValue(readyPolicy),
    setRetention: vi.fn().mockResolvedValue(readyRetention),
    deleteHistory: vi.fn().mockResolvedValue({
      observationsDeleted: 1,
      episodesDeleted: 1,
      episodesRebuilt: 0,
    }),
    rotatePairing: vi.fn().mockResolvedValue({
      token: 'once',
      paired: false,
      listening: true,
      port: 4123,
    }),
  }
}

describe('client control store', () => {
  it('coalesces concurrent initial loads', async () => {
    const backend = fakeControlApi()
    const store = createHistoryControlStore(backend)
    await Promise.all([store.load(), store.load()])

    expect(backend.getState).toHaveBeenCalledTimes(1)
    expect(backend.getPolicy).toHaveBeenCalledTimes(1)
    expect(backend.getRetention).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().status).toBe('ready')
  })

  it('folds capture mutation responses without refetching state', async () => {
    const backend = fakeControlApi()
    const store = createHistoryControlStore(backend)
    await store.load()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    await store.pause()

    expect(store.getSnapshot().state?.capture).toBe('paused')
    expect(backend.getState).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })

  it('bumps historyRevision after destructive history changes', async () => {
    const backend = fakeControlApi()
    const store = createHistoryControlStore(backend)
    await store.load()
    const before = store.getSnapshot().historyRevision

    await store.deleteHistory({ scope: { kind: 'all' } })

    expect(store.getSnapshot().historyRevision).toBe(before + 1)
  })

  it('keeps load failure distinct from an empty or paused state', async () => {
    const backend = fakeControlApi()
    backend.getState.mockRejectedValueOnce(new Error('offline'))
    const store = createHistoryControlStore(backend)

    await expect(store.load()).rejects.toThrow('offline')

    expect(store.getSnapshot()).toMatchObject({
      status: 'error',
      error: 'offline',
    })
    expect(store.getSnapshot().state).toBeUndefined()
  })

  it('replaces stale companion state after rotating the pairing token', async () => {
    const backend = fakeControlApi()
    backend.getState.mockResolvedValueOnce({
      ...readyState,
      companion: {
        listening: true,
        paired: true,
        port: 9999,
        lastSeenAtMs: 123,
        reason: 'old state',
      },
    })
    backend.rotatePairing.mockResolvedValueOnce({
      token: 'new-token',
      listening: false,
      paired: false,
    })
    const store = createHistoryControlStore(backend)
    await store.load()

    await store.rotatePairing()

    expect(store.getSnapshot().state?.companion).toEqual({
      listening: false,
      paired: false,
    })
  })
})
