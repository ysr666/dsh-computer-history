/**
 * Independent release-journey assertion for the consent shown on a fresh Host.
 * Expected allow rules depend on the machine's supported-app inventory; the
 * separately paired browser companion is not an installed desktop app.
 *
 * Rejects silent blanket allow rules, missing installed apps, and a missing
 * browser companion instead of hardcoding an app that may not be installed on
 * the GitHub macOS runner.
 */
export function inspectFirstRunPolicy({ preset, inventory, policy }) {
  if (!Array.isArray(preset?.bundles)
    || !preset.bundles.includes('companion.browser')
    || typeof inventory?.available !== 'boolean'
    || !Array.isArray(inventory.applications)
    || policy?.mode !== 'include-only'
    || !Array.isArray(policy.rules)) {
    return { ok: false, reason: 'first-run state, inventory, or include-only policy missing' }
  }

  const installed = new Set(inventory.applications.map(app => app.bundleId))
  const expected = new Set(preset.bundles.filter(bundle =>
    !inventory.available || bundle === 'companion.browser' || installed.has(bundle),
  ))
  const actual = new Set(policy.rules
    .filter(rule => rule.dimension === 'app' && rule.action === 'allow')
    .map(rule => rule.pattern))
  const missing = [...expected].filter(bundle => !actual.has(bundle))
  const unexpected = [...actual].filter(bundle => !expected.has(bundle))

  return {
    ok: missing.length === 0 && unexpected.length === 0,
    expectedCount: expected.size,
    actualCount: actual.size,
    inventoryAvailable: inventory.available,
    missing,
    unexpected,
  }
}
