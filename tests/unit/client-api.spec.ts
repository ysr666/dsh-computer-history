import { afterEach, describe, expect, it, vi } from 'vitest'
import { historyApi } from '../../src/client/api.js'

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('client history API contract', () => {
  it('posts retention to the registered route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      observationRetentionHours: 48,
      episodeRetentionDays: 60,
      updatedAtMs: 1,
    }))
    vi.stubGlobal('fetch', fetchMock)

    await historyApi.setRetention({
      observationRetentionHours: 48,
      episodeRetentionDays: 60,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('api/computer-history/retention')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      observationRetentionHours: 48,
      episodeRetentionDays: 60,
    })
  })

  it('uses the shared deletion request shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      observationsDeleted: 3,
      episodesDeleted: 2,
      episodesRebuilt: 0,
    }))
    vi.stubGlobal('fetch', fetchMock)

    await historyApi.deleteHistory({ scope: { kind: 'all' } })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('api/computer-history/delete')
    expect(JSON.parse(String(init.body))).toEqual({
      scope: { kind: 'all' },
    })
  })

  it('reads browser companion install information through the typed API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      chromium: { available: true, extensionPath: '/tmp/extension' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(historyApi.getCompanionSetup()).resolves.toEqual({
      chromium: { available: true, extensionPath: '/tmp/extension' },
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'api/computer-history/companion/setup',
    )
  })

  it('rotates the companion token through /pairing/rotate', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      token: 'once', paired: false, listening: true, port: 4123,
    }))
    vi.stubGlobal('fetch', fetchMock)

    await historyApi.rotatePairing()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'api/computer-history/pairing/rotate',
    )
  })

  it('returns the Host canonical state from capture actions', async () => {
    const state = {
      enabled: true,
      capture: 'paused',
      accessibilityTrusted: true,
      observationRetentionHours: 24,
      episodeRetentionDays: 30,
      autoResume: false,
    } as const
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(state))
    vi.stubGlobal('fetch', fetchMock)

    await expect(historyApi.pause()).resolves.toEqual(state)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('api/computer-history/pause')
  })


  it('uses the dedicated Resume open action without sending an arbitrary command', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ available: true }))
      .mockResolvedValueOnce(jsonResponse({ status: 'opened', kind: 'file' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(historyApi.getResumeOpenCapability()).resolves.toEqual({
      available: true,
    })
    await expect(historyApi.openResume({
      episodeId: 'episode:1' as never,
      resourceCanonicalUri: 'file:///tmp/report.md',
    })).resolves.toEqual({ status: 'opened', kind: 'file' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('api/computer-history/resume/open')
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('api/computer-history/resume/open')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      episodeId: 'episode:1',
      resourceCanonicalUri: 'file:///tmp/report.md',
    })
  })

  it('surfaces a non-2xx Host message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('capture is owned by another Host', { status: 409 }),
    ))

    await expect(historyApi.pause()).rejects.toThrow(
      'capture is owned by another Host',
    )
  })
})
