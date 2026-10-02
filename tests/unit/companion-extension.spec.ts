import { describe, expect, it } from 'vitest'
// Plain ESM: the extension is loaded by Chrome, not bundled by the plugin.
import {
  buildPayload,
  checkPairing,
  isReportableUrl,
  normalizeUrl,
  sendObservation,
  shouldReportTab,
} from '../../extension/lib.js'
import type { CompanionExtensionPayload } from '../../extension/lib.js'

describe('companion extension logic', () => {
  it('never reports an incognito tab, whatever else it looks like', () => {
    const tab = {
      incognito: true,
      url: 'https://example.test/docs',
      title: 'Example',
    }
    expect(shouldReportTab(tab)).toBe(false)
    expect(buildPayload(tab, 'session', 1)).toBeUndefined()
  })

  it('reports only http(s) pages', () => {
    expect(isReportableUrl('https://example.test/x')).toBe(true)
    expect(isReportableUrl('http://example.test/x')).toBe(true)
    for (const url of [
      'chrome://settings',
      'chrome-extension://abc/options.html',
      'file:///tmp/secret.txt',
      'about:blank',
      'devtools://devtools/bundled/x.html',
      'not a url',
    ]) {
      expect(isReportableUrl(url), url).toBe(false)
    }
    expect(shouldReportTab({ url: 'chrome://settings' })).toBe(false)
    expect(shouldReportTab({})).toBe(false)
    expect(shouldReportTab(undefined)).toBe(false)
  })

  it('strips the query string and the fragment', () => {
    expect(normalizeUrl('https://example.test/docs/guide?token=secret#part-3'))
      .toEqual({ origin: 'https://example.test', path: '/docs/guide' })
    const payload = buildPayload(
      { url: 'https://example.test/a?q=1#x', title: 'A', incognito: false },
      'session-1',
      4,
      1_000,
    )
    expect(payload).toEqual({
      origin: 'https://example.test',
      path: '/a',
      title: 'A',
      incognito: false,
      browserSession: 'session-1',
      seq: 4,
      observedAtMs: 1_000,
    })
    expect(JSON.stringify(payload)).not.toContain('q=1')
  })

  it('omits an empty title rather than sending an empty string', () => {
    const payload = buildPayload(
      { url: 'https://example.test/', title: '', incognito: false },
      's',
      1,
      1,
    )
    expect(payload).toBeDefined()
    expect('title' in (payload as object)).toBe(false)
  })

  it('sends the token header and reports the status', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fakeFetch = async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response('{}', { status: 201 })
    }
    const payload: CompanionExtensionPayload = {
      origin: 'https://example.test',
      path: '/',
      incognito: false,
      browserSession: 's',
      seq: 1,
      observedAtMs: 1,
    }
    const status = await sendObservation(
      fakeFetch as unknown as typeof fetch,
      { port: 19388, token: 'tok' },
      payload,
    )
    expect(status).toBe(201)
    expect(calls[0]!.url).toBe('http://127.0.0.1:19388/companion/observation')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['x-companion-token']).toBe('tok')
    expect(calls[0]!.init.body).toContain('https://example.test')
  })

  it('checks pairing against the health route', async () => {
    const ok = await checkPairing(
      (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
      { port: 19388, token: 'tok' },
    )
    expect(ok).toBe(true)
    const rejected = await checkPairing(
      (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch,
      { port: 19388, token: 'wrong' },
    )
    expect(rejected).toBe(false)
  })
})
