import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PHASE1_ADAPTERS } from './constants.js'

/**
 * The first-run preset: which applications a fresh install records.
 *
 * It is data (`presets/*.json`), and it names **surface kinds**, not bundle ids:
 * a hardcoded list of bundle ids would drift away from the adapter table the
 * moment an adapter is added, and the drift would be silent - the preset would
 * simply stop covering a supported application. Expanding it through the same
 * table the ingestion path uses means the preset can never allow something this
 * build cannot understand, and it can never miss an application the build does.
 *
 * Built-in protection is not affected: protected applications are not adapters,
 * so they are not in the expansion, and the store keeps built-in rules when a
 * policy is replaced.
 */
export interface FirstRunPreset {
  readonly id: string
  readonly title: Readonly<Record<string, string>>
  readonly description: Readonly<Record<string, string>>
  readonly allowSurfaceKinds: readonly string[]
}

export function isFirstRunPreset(value: unknown): value is FirstRunPreset {
  if (typeof value !== 'object' || value === null) return false
  const preset = value as Partial<FirstRunPreset>
  return typeof preset.id === 'string'
    && typeof preset.title === 'object' && preset.title !== null
    && typeof preset.description === 'object' && preset.description !== null
    && Array.isArray(preset.allowSurfaceKinds)
    && preset.allowSurfaceKinds.every(kind => typeof kind === 'string')
}

/** Every bundle id the preset would allow, in a stable order. */
export function presetBundles(preset: FirstRunPreset): readonly string[] {
  const kinds = new Set(preset.allowSurfaceKinds)
  const bundles = PHASE1_ADAPTERS
    .filter(adapter => kinds.has(adapter.surfaceKind))
    .flatMap(adapter => adapter.bundleIds)
  return Array.from(new Set(bundles)).toSorted()
}

/**
 * The package root, found by walking up from this module.
 *
 * The built layout is flat (`lib/index.js`) while the sources are nested
 * (`src/host/plugin.ts`), so a fixed number of `..` segments is wrong in one of the two
 * - and it failed silently, because the reader below treats "cannot read the preset" as
 * "no preset". Walking to the directory that holds package.json is correct in both.
 */
export function packageRoot(from: string): string {
  let directory = path.dirname(from)
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(directory, 'package.json'))) return directory
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error('package root not found')
}

/** The shipped first-run preset, or undefined when it is not in this installation. */
export function readFirstRunPreset(
  from: string = fileURLToPath(import.meta.url),
): FirstRunPreset | undefined {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(path.join(packageRoot(from), 'presets', 'first-run.json'), 'utf8'),
    )
    return isFirstRunPreset(raw) ? raw : undefined
  } catch {
    return undefined
  }
}
