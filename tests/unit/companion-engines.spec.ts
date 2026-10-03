import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// The companion runs on two engines. What can be checked without a browser is that the two
// manifests describe the *same* extension - same permissions, same private-window refusal,
// same background implementation - and that only the engine-specific keys differ. A second
// copy of the wiring is what would drift, so one of these asserts there is no second copy.
const chromeManifest = JSON.parse(
  readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8'),
) as Record<string, never>
const firefoxManifest = JSON.parse(
  readFileSync(new URL('../../extension/manifest.firefox.json', import.meta.url), 'utf8'),
) as Record<string, never>

const entry = 'service-worker.js'

describe('companion on a second engine', () => {
  it('describes one extension, with the privacy posture identical on both engines', () => {
    for (const manifest of [chromeManifest, firefoxManifest]) {
      expect(manifest.manifest_version).toBe(3)
      expect(manifest.incognito).toBe('not_allowed')
      expect(manifest.permissions).toEqual(['tabs', 'storage'])
      expect(manifest.host_permissions).toEqual(['http://127.0.0.1/*', 'http://localhost/*'])
      expect(String(manifest.description)).toContain('no page content')
    }
    expect(firefoxManifest.description).toBe(chromeManifest.description)
  })

  it('uses each engine’s own background declaration for the same entry file', () => {
    expect(chromeManifest.background).toEqual({ service_worker: entry, type: 'module' })
    expect(firefoxManifest.background).toEqual({ scripts: [entry], type: 'module' })
    // Gecko has no service worker, and Chromium has no event page: the difference is the key.
    expect(firefoxManifest.background).not.toHaveProperty('service_worker')
    expect(chromeManifest.background).not.toHaveProperty('scripts')
    expect(chromeManifest.minimum_chrome_version).toBeDefined()
  })

  it('gives Gecko the extension id it needs to keep storage and permissions', () => {
    const gecko = (firefoxManifest as unknown as {
      browser_specific_settings?: { gecko?: { id?: string; strict_min_version?: string } }
    }).browser_specific_settings?.gecko
    expect(gecko?.id).toBeTruthy()
    expect(gecko?.strict_min_version).toBeTruthy()
    // `options_ui` is the cross-engine form; `options_page` is the Chromium-only one.
    expect(firefoxManifest).toHaveProperty('options_ui')
    expect(firefoxManifest).not.toHaveProperty('options_page')
  })

  it('keeps one implementation behind the two entries', () => {
    const entrySource = readFileSync(new URL(`../../extension/${entry}`, import.meta.url), 'utf8')
    const wiring = readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8')
    // The entry starts the wiring; it must not grow its own listeners.
    expect(entrySource).toContain("from './background.js'")
    expect(entrySource).toContain('startCompanion()')
    expect(entrySource).not.toContain('addListener')
    // Every listener lives in the shared file, and none of them names an engine directly.
    for (const listener of ['onActivated', 'onUpdated', 'onFocusChanged', 'onInstalled']) {
      expect(wiring).toContain(listener)
    }
    expect(wiring).not.toMatch(/\bchrome\./)
    expect(wiring).toContain("from './engine.js'")
  })

  it('resolves the promise-based namespace on either engine', async () => {
    const chromeLike = { storage: {}, tabs: {}, windows: {}, runtime: {} }
    const browserLike = { storage: {}, tabs: {}, windows: {}, runtime: {} }

    vi.resetModules()
    vi.stubGlobal('chrome', chromeLike)
    vi.stubGlobal('browser', undefined)
    const onlyChrome = await import('../../extension/engine.js')
    expect(onlyChrome.ext).toBe(chromeLike)

    // Gecko defines both names; only `browser.*` is promise-based there, so it must win.
    vi.resetModules()
    vi.stubGlobal('chrome', chromeLike)
    vi.stubGlobal('browser', browserLike)
    const both = await import('../../extension/engine.js')
    expect(both.ext).toBe(browserLike)

    vi.unstubAllGlobals()
  })
})
