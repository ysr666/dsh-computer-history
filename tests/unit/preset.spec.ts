import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { PHASE1_ADAPTERS } from '../../src/shared/constants.js'
import { isFirstRunPreset, presetBundles, readFirstRunPreset } from '../../src/shared/preset.js'

async function shippedPreset(): Promise<ReturnType<typeof presetBundles>> {
  const raw: unknown = JSON.parse(
    await readFile(new URL('../../presets/first-run.json', import.meta.url), 'utf8'),
  )
  if (!isFirstRunPreset(raw)) throw new Error('presets/first-run.json is not a preset')
  return presetBundles(raw)
}

describe('the first-run preset', () => {
  it('covers the applications this build understands', async () => {
    const bundles = await shippedPreset()
    for (const expected of [
      'com.microsoft.VSCode',
      'com.todesktop.230313mzl4w4u92',
      'com.apple.Terminal',
      'com.apple.finder',
    ]) {
      expect(bundles).toContain(expected)
    }
  })

  it('allows only applications this build understands', async () => {
    const known = new Set(PHASE1_ADAPTERS.flatMap(adapter => adapter.bundleIds))
    for (const bundle of await shippedPreset()) {
      expect(known.has(bundle)).toBe(true)
    }
  })

  it('does not promise browsers through the Accessibility path', async () => {
    const bundles = await shippedPreset()
    // Only the companion's synthetic source exists for browsers: the AX path cannot
    // tell a private window from a normal one, so no real browser bundle id may appear.
    expect(bundles).toContain('companion.browser')
    for (const realBrowser of ['com.google.Chrome', 'org.mozilla.firefox']) {
      expect(bundles).not.toContain(realBrowser)
    }
  })

  it('filters runtime presets to the current platform identity shape', async () => {
    const raw: unknown = JSON.parse(
      await readFile(new URL('../../presets/first-run.json', import.meta.url), 'utf8'),
    )
    if (!isFirstRunPreset(raw)) throw new Error('presets/first-run.json is not a preset')
    const mac = presetBundles(raw, 'darwin')
    expect(mac).toContain('com.microsoft.VSCode')
    expect(mac).toContain('companion.browser')
    expect(mac).not.toContain('Code.exe')
    expect(mac).not.toContain('code.desktop')
  })

  it('is stable: the same preset expands to the same list', async () => {
    expect(await shippedPreset()).toEqual(await shippedPreset())
  })
})

describe('finding the shipped preset', () => {
  it('works from a flat build and from a nested source path', () => {
    // The bug this pins: the built layout is lib/index.js while the sources are nested, so a
    // fixed ../../ was correct in one and silently wrong in the other - and the reader treats
    // "cannot read it" as "no preset", so the only symptom was a missing field.
    const repo = new URL('../../', import.meta.url).pathname
    expect(readFirstRunPreset(`${repo}lib/index.js`)).toBeDefined()
    expect(readFirstRunPreset(`${repo}src/host/plugin.ts`)).toBeDefined()
    expect(readFirstRunPreset(`${repo}src/host/plugin.ts`)?.id).toBe('first-run')
  })
})
