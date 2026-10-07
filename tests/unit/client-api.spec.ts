import { afterEach, describe, expect, it, vi } from 'vitest'
import { historyApi } from '../../src/client/api.js'

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('client history API contract', () => {
  it('takes an explicit safe download filename from the Host HEAD response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 200,
      headers: {
        'content-disposition': 'attachment; filename="computer-history-diagnostics-2026-10-05.json"',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(historyApi.prepareDownloadRoute('/diagnostics')).resolves.toEqual({
      href: 'api/computer-history/diagnostics',
      filename: 'computer-history-diagnostics-2026-10-05.json',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'api/computer-history/diagnostics',
      expect.objectContaining({ method: 'HEAD', credentials: 'same-origin' }),
    )
  })

  it('does not trust an unsafe download filename from a response header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 200,
      headers: {
        'content-disposition': 'attachment; filename="../private.json"',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(historyApi.prepareDownloadRoute('/diagnostics')).resolves.toEqual({
      href: 'api/computer-history/diagnostics',
    })
  })

  it('uses the fixed capture recovery action', async () => {
    const state = {
      enabled: true,
      capture: 'running',
      accessibilityTrusted: true,
      observationRetentionHours: 24,
      episodeRetentionDays: 30,
      autoResume: false,
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(state))
    vi.stubGlobal('fetch', fetchMock)

    await expect(historyApi.recover()).resolves.toEqual(state)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('api/computer-history/recover')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })

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

  it('uses the fixed Accessibility Settings Host action', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ available: true }))
      .mockResolvedValueOnce(jsonResponse({ status: 'opened' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(historyApi.getAccessibilitySettingsCapability()).resolves.toEqual({
      available: true,
    })
    await expect(historyApi.openAccessibilitySettings()).resolves.toEqual({
      status: 'opened',
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'api/computer-history/system/accessibility',
    )
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('api/computer-history/system/accessibility')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })

  it('reads the verified installed-application inventory through the typed API', async () => {
    const inventory = {
      available: true,
      applications: [{
        bundleId: 'com.microsoft.VSCode',
        name: 'Visual Studio Code',
        surfaceKind: 'editor',
      }],
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(inventory))
    vi.stubGlobal('fetch', fetchMock)

    await expect(historyApi.getSupportedApplications()).resolves.toEqual(inventory)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'api/computer-history/system/applications',
    )
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

  it('exports and imports history through the typed data routes', async () => {
    const exported = {
      schema: 'dsh-computer-history-export-v1',
      exportedAtMs: 1,
      schemaVersion: 1,
      tables: {},
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(exported))
      .mockResolvedValueOnce(jsonResponse({ imported: { episodes: 2 } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(historyApi.exportHistory()).resolves.toEqual(exported)
    await expect(historyApi.importHistory(exported)).resolves.toEqual({
      imported: { episodes: 2 },
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('api/computer-history/export')
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('api/computer-history/import')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
    expect(init.body).toBe(JSON.stringify(exported))
  })

  it('uses the fixed VS Code companion install action', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ available: true, installed: false }))
      .mockResolvedValueOnce(jsonResponse({ status: 'installed' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(historyApi.getEditorCompanionInstallCapability()).resolves.toEqual({
      available: true,
      installed: false,
    })
    await expect(historyApi.installEditorCompanion()).resolves.toEqual({
      status: 'installed',
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('api/computer-history/companion/editor')
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('api/computer-history/companion/editor')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
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

  it('reads one work thread through the encoded project-history route', async () => {
    const detail = {
      thread: {
        threadKey: 'workspace:alpha/beta',
        episodeIds: [],
        episodeCount: 0,
        startedAtMs: 0,
        endedAtMs: 0,
        resources: [],
        summary: '',
        summaryObservationIds: [],
      },
      timeline: [],
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(detail))
    vi.stubGlobal('fetch', fetchMock)

    await expect(historyApi.getThread('workspace:alpha/beta')).resolves.toEqual(detail)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'api/computer-history/thread?threadKey=workspace%3Aalpha%2Fbeta',
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


  it('reads one stored Episode continuity handoff through the encoded route', async () => {
    const handoff = {
      status: 'hit',
      episodeId: 'episode:alpha',
      startedAtMs: 1,
      lastActiveAtMs: 2,
      recentResources: [],
      referenceResources: [],
      changedResources: [],
      verifications: [],
      surfaces: [],
      confidence: 1,
      reasons: ['recent-episode'],
      evidenceObservationIds: [1],
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(handoff))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      historyApi.getResumeHandoff('episode:alpha'),
    ).resolves.toEqual(handoff)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'api/computer-history/resume/handoff?id=episode%3Aalpha',
    )
  })

  it('binds a fresh DSH continuation session to an exact stored Episode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ bound: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(historyApi.bindContinuationSession({
      sessionId: 'session:new',
      episodeId: 'episode:1' as never,
    })).resolves.toEqual({ bound: true })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('api/computer-history/resume/continue-session')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      sessionId: 'session:new',
      episodeId: 'episode:1',
    })
  })

  it('unbinds a failed continuation session through the fixed cleanup route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ unbound: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      historyApi.unbindContinuationSession('session:new'),
    ).resolves.toEqual({ unbound: true })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('api/computer-history/resume/continue-session/unbind')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      sessionId: 'session:new',
    })
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
