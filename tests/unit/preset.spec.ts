import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { PHASE1_ADAPTERS } from '../../src/shared/constants.js'
import { isFirstRunPreset, presetBundles } from '../../src/shared/preset.js'

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

  it('is stable: the same preset expands to the same list', async () => {
    expect(await shippedPreset()).toEqual(await shippedPreset())
  })
})
