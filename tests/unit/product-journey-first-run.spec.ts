import { describe, expect, it } from 'vitest'
import { inspectFirstRunPolicy } from '../../scripts/product-journey-first-run.mjs'

const preset = { bundles: [
  'com.microsoft.VSCode',
  'com.google.Chrome',
  'companion.browser',
] }
const appRule = (pattern: string) => ({
  dimension: 'app', action: 'allow', pattern,
})
const policy = (...patterns: string[]) => ({
  mode: 'include-only', rules: patterns.map(appRule),
})

describe('release first-run inventory gate', () => {
  it('accepts exactly the installed preset apps and browser companion', () => {
    expect(inspectFirstRunPolicy({
      preset,
      inventory: { available: true, applications: [{ bundleId: 'com.google.Chrome' }] },
      policy: policy('com.google.Chrome', 'companion.browser'),
    })).toMatchObject({
      ok: true, expectedCount: 2, actualCount: 2,
      missing: [], unexpected: [],
    })
  })

  it('rejects allowing VS Code by default when it is not installed', () => {
    expect(inspectFirstRunPolicy({
      preset,
      inventory: { available: true, applications: [{ bundleId: 'com.google.Chrome' }] },
      policy: policy('com.google.Chrome', 'companion.browser', 'com.microsoft.VSCode'),
    })).toMatchObject({ ok: false, unexpected: ['com.microsoft.VSCode'] })
  })

  it('rejects omissions of installed supported apps or companion', () => {
    const inventory = { available: true, applications: [
      { bundleId: 'com.microsoft.VSCode' }, { bundleId: 'com.google.Chrome' },
    ] }
    expect(inspectFirstRunPolicy({ preset, inventory, policy: policy('companion.browser') }))
      .toMatchObject({ ok: false, missing: ['com.microsoft.VSCode', 'com.google.Chrome'] })
    expect(inspectFirstRunPolicy({
      preset, inventory, policy: policy('com.microsoft.VSCode', 'com.google.Chrome'),
    })).toMatchObject({ ok: false, missing: ['companion.browser'] })
  })

  it('accepts the complete preset if inventory is unverified, never guesses installed apps', () => {
    expect(inspectFirstRunPolicy({
      preset,
      inventory: { available: false, applications: [] },
      policy: policy('com.microsoft.VSCode', 'com.google.Chrome', 'companion.browser'),
    })).toMatchObject({ ok: true, expectedCount: 3 })
  })

  it('rejects unavailable policy metadata and blanket unapproved apps', () => {
    expect(inspectFirstRunPolicy({
      preset,
      inventory: { available: true, applications: [] },
      policy: { mode: 'exclude-only', rules: [appRule('companion.browser')] },
    })).toMatchObject({ ok: false })
    expect(inspectFirstRunPolicy({
      preset,
      inventory: { available: true, applications: [] },
      policy: policy('companion.browser', 'com.apple.KeychainAccess'),
    })).toMatchObject({ ok: false, unexpected: ['com.apple.KeychainAccess'] })
  })
})
