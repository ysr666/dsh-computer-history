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
    recover: vi.fn().mockResolvedValue(readyState),
    replacePolicy: vi.fn().mockResolvedValue(readyPolicy),
    setRetention: vi.fn().mockResolvedValue(readyRetention),
    deleteHistory: vi.fn().mockResolvedValue({
      observationsDeleted: 1,
      episodesDeleted: 1,
      episodesRebuilt: 0,
    }),
    importHistory: vi.fn().mockResolvedValue({ imported: { episodes: 2 } }),
    rotatePairing: vi.fn().mockResolvedValue({
      token: 'once',
      paired: false,
      listening: true,
      port: 4123,
    }),
    installEditorCompanion: vi.fn().mockResolvedValue({
      status: 'already-installed',
      configured: true,
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
    await store.recover()
    expect(store.getSnapshot().state?.capture).toBe('running')
    expect(backend.recover).toHaveBeenCalledTimes(1)
    expect(backend.getState).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })


  it('refreshes live capture health while subscribed and stops after unsubscribe', async () => {
    vi.useFakeTimers()
    try {
      const backend = fakeControlApi()
      backend.getState
        .mockResolvedValueOnce(readyState)
        .mockResolvedValueOnce({
          ...readyState,
          capture: 'degraded',
          reason: 'collector-exited',
        })
      const store = createHistoryControlStore(backend)
      await store.load()
      const listener = vi.fn()
      const unsubscribe = store.subscribe(listener)

      await vi.advanceTimersByTimeAsync(2_000)

      expect(backend.getState).toHaveBeenCalledTimes(2)
      expect(store.getSnapshot().state).toMatchObject({
        capture: 'degraded',
        reason: 'collector-exited',
      })
      expect(listener).toHaveBeenCalled()

      unsubscribe()
      await vi.advanceTimersByTimeAsync(4_000)
      expect(backend.getState).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the last trusted state when a background health refresh fails', async () => {
    vi.useFakeTimers()
    try {
      const backend = fakeControlApi()
      backend.getState
        .mockResolvedValueOnce(readyState)
        .mockRejectedValueOnce(new Error('transient state read failure'))
      const store = createHistoryControlStore(backend)
      await store.load()
      const unsubscribe = store.subscribe(() => {})

      await vi.advanceTimersByTimeAsync(2_000)

      expect(store.getSnapshot().status).toBe('ready')
      expect(store.getSnapshot().state?.capture).toBe('running')
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let an older state poll overwrite a successful retention save', async () => {
    const backend = fakeControlApi()
    const store = createHistoryControlStore(backend)
    await store.load()

    let resolveOldState!: (value: ComputerHistoryState) => void
    const oldState = new Promise<ComputerHistoryState>(resolve => {
      resolveOldState = resolve
    })
    backend.getState.mockReturnValueOnce(oldState)
    const refreshing = store.refreshState()

    const changed: RetentionSettings = {
      observationRetentionHours: 6,
      episodeRetentionDays: 14,
      updatedAtMs: 2,
    }
    backend.setRetention.mockResolvedValueOnce(changed)
    await store.setRetention({
      observationRetentionHours: 6,
      episodeRetentionDays: 14,
    })

    resolveOldState(readyState)
    await refreshing

    expect(store.getSnapshot().state).toMatchObject({
      observationRetentionHours: 6,
      episodeRetentionDays: 14,
    })
    expect(store.getSnapshot().retention).toEqual(changed)
  })

  it('does not let a pre-install state poll undo editor pairing after configuration succeeds', async () => {
    const backend = fakeControlApi()
    const initial: ComputerHistoryState = {
      ...readyState,
      companion: {
        listening: true,
        paired: false,
        editorPaired: false,
      },
    }
    backend.getState.mockResolvedValueOnce(initial)
    const store = createHistoryControlStore(backend)
    await store.load()

    let resolveOldState!: (value: ComputerHistoryState) => void
    const oldState = new Promise<ComputerHistoryState>(resolve => {
      resolveOldState = resolve
    })
    backend.getState.mockReturnValueOnce(oldState)
    const refreshing = store.refreshState()

    await expect(store.installEditorCompanion()).resolves.toMatchObject({
      configured: true,
    })

    const paired: ComputerHistoryState = {
      ...readyState,
      companion: {
        listening: true,
        paired: false,
        editorPaired: true,
      },
    }
    backend.getState.mockResolvedValueOnce(paired)
    await store.reload()

    resolveOldState(initial)
    await refreshing

    expect(store.getSnapshot().state?.companion?.editorPaired).toBe(true)
  })

  it('does not let a reload started before a policy write restore the old policy', async () => {
    const backend = fakeControlApi()
    const store = createHistoryControlStore(backend)
    await store.load()

    let resolveOldPolicy!: (value: PolicySnapshot) => void
    const oldPolicy = new Promise<PolicySnapshot>(resolve => {
      resolveOldPolicy = resolve
    })
    backend.getPolicy.mockReturnValueOnce(oldPolicy)

    const reloading = store.reload()
    const changed: PolicySnapshot = {
      ...readyPolicy,
      revision: 2,
      updatedAtMs: 2,
    }
    backend.replacePolicy.mockResolvedValueOnce(changed)
    await store.replacePolicy({
      mode: 'include-only',
      rules: [],
    })

    resolveOldPolicy(readyPolicy)
    await reloading

    expect(store.getSnapshot().policy).toEqual(changed)
    expect(store.getSnapshot().status).toBe('ready')
  })

  it('returns to ready when delete supersedes an older reload', async () => {
    const backend = fakeControlApi()
    const store = createHistoryControlStore(backend)
    await store.load()

    let resolveOldPolicy!: (value: PolicySnapshot) => void
    backend.getPolicy.mockReturnValueOnce(new Promise<PolicySnapshot>(resolve => {
      resolveOldPolicy = resolve
    }))

    const reloading = store.reload()
    expect(store.getSnapshot().status).toBe('loading')

    await store.deleteHistory({ scope: { kind: 'all' } })
    expect(store.getSnapshot().status).toBe('ready')

    resolveOldPolicy(readyPolicy)
    await reloading
    expect(store.getSnapshot().status).toBe('ready')
  })

  it('returns to ready when import supersedes an older reload', async () => {
    const backend = fakeControlApi()
    const store = createHistoryControlStore(backend)
    await store.load()

    let resolveOldPolicy!: (value: PolicySnapshot) => void
    backend.getPolicy.mockReturnValueOnce(new Promise<PolicySnapshot>(resolve => {
      resolveOldPolicy = resolve
    }))

    const reloading = store.reload()
    expect(store.getSnapshot().status).toBe('loading')

    await store.importHistory({ schema: 'test' })
    expect(store.getSnapshot().status).toBe('ready')

    resolveOldPolicy(readyPolicy)
    await reloading
    expect(store.getSnapshot().status).toBe('ready')
  })

  it('returns to ready when pairing rotation supersedes an older reload', async () => {
    const backend = fakeControlApi()
    const store = createHistoryControlStore(backend)
    await store.load()

    let resolveOldPolicy!: (value: PolicySnapshot) => void
    backend.getPolicy.mockReturnValueOnce(new Promise<PolicySnapshot>(resolve => {
      resolveOldPolicy = resolve
    }))

    const reloading = store.reload()
    expect(store.getSnapshot().status).toBe('loading')

    await store.rotatePairing()
    expect(store.getSnapshot().status).toBe('ready')

    resolveOldPolicy(readyPolicy)
    await reloading
    expect(store.getSnapshot().status).toBe('ready')
  })

  it('bumps historyRevision after destructive history changes', async () => {
    const backend = fakeControlApi()
    const store = createHistoryControlStore(backend)
    await store.load()
    const before = store.getSnapshot().historyRevision

    await store.deleteHistory({ scope: { kind: 'all' } })

    expect(store.getSnapshot().historyRevision).toBe(before + 1)
  })

  it('bumps historyRevision after importing history', async () => {
    const backend = fakeControlApi()
    const store = createHistoryControlStore(backend)
    await store.load()
    const before = store.getSnapshot().historyRevision
    const document = { schema: 'test' }

    await expect(store.importHistory(document)).resolves.toEqual({
      imported: { episodes: 2 },
    })

    expect(backend.importHistory).toHaveBeenCalledWith(document)
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
        lastSeenAtMs: 456,
        browserLastSeenAtMs: 456,
        editorPaired: true,
        editorLastSeenAtMs: 123,
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
      editorPaired: true,
      editorLastSeenAtMs: 123,
      lastSeenAtMs: 123,
    })
  })
})
