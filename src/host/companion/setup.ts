import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { BrowserCompanionSetup } from '../../shared/index.js'

/**
 * Resolve the unpacked Chromium companion shipped with this package.
 *
 * Package self-resolution is deliberate: the Desktop Host can install this
 * plugin into any profile directory, so neither DSH_HOME nor process.cwd() is
 * a stable package location. The package exports its own package.json, which
 * gives us one location that works in a packed install and in the repo.
 */
export function browserCompanionSetup(): BrowserCompanionSetup {
  let packageJsonPath: string
  try {
    packageJsonPath = createRequire(import.meta.url)
      .resolve('dsh-computer-history/package.json')
  } catch {
    return { chromium: { available: false } }
  }

  const extensionPath = path.join(
    path.dirname(packageJsonPath),
    'dist',
    'extension',
  )
  const available = existsSync(path.join(extensionPath, 'manifest.json'))
  return {
    chromium: available
      ? { available: true, extensionPath }
      : { available: false },
  }
}
