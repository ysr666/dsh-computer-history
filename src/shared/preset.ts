import { existsSync, readFileSync, statSync } from 'node:fs'
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

/** Whether an adapter identity belongs to one runtime platform. */
function bundleMatchesPlatform(bundleId: string, platform: string): boolean {
  if (bundleId === 'companion.browser') return true
  if (platform === 'win32') return bundleId.endsWith('.exe')
  if (platform === 'linux') return bundleId.endsWith('.desktop')
  if (platform === 'darwin') {
    return !bundleId.endsWith('.exe') && !bundleId.endsWith('.desktop')
  }
  return false
}

/** Every bundle id the preset would allow, in a stable order. */
export function presetBundles(
  preset: FirstRunPreset,
  platform?: string,
): readonly string[] {
  const kinds = new Set(preset.allowSurfaceKinds)
  const bundles = PHASE1_ADAPTERS
    .filter(adapter => kinds.has(adapter.surfaceKind))
    .flatMap(adapter => adapter.bundleIds)
    .filter(bundleId => platform === undefined || bundleMatchesPlatform(bundleId, platform))
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

/**
 * What the running code is, so "am I running a stale copy" becomes answerable.
 *
 * Three facts the plugin can establish about itself: the version it declares, where the module was
 * loaded from, and when its own built entry was last written. The comparison against a checkout or an
 * artifact belongs to the caller - this reports, it does not judge.
 */
export interface RunningRelease {
  readonly version: string
  readonly loadedFrom: string
  readonly builtAtMs?: number
  /** Set when the profile's dependency points at an artifact older than the installed code. */
  readonly stale?: {
    readonly profile: string
    readonly artifact: string
    readonly artifactAtMs: number
    readonly updateCommand: string
  }
}

export function runningRelease(
  from: string = fileURLToPath(import.meta.url),
): RunningRelease | undefined {
  try {
    const root = packageRoot(from)
    const manifest: unknown = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    const version = (manifest as { version?: unknown }).version
    if (typeof version !== 'string') return undefined
    let builtAtMs: number | undefined
    try {
      builtAtMs = Math.round(statSync(path.join(root, 'lib', 'index.js')).mtimeMs)
    } catch {
      builtAtMs = undefined
    }
    return { version, loadedFrom: root, ...(builtAtMs === undefined ? {} : { builtAtMs }) }
  } catch {
    return undefined
  }
}

/**
 * Does the profile that installed this copy point at an artifact predating the installed code?
 *
 * The failure this catches has already cost this phase twice: the plugin is changed and built, the
 * profile still runs the previous copy, and the result looks exactly like a broken feature. The plugin
 * can work it out without any help - it knows where it was loaded from, and it can find the profile
 * whose node_modules resolves to that directory - so the interface does not have to guess.
 */

/*
 * There was a drift flag here, comparing the artifact's timestamp with the installed copy's. The owner's own
 * install showed what it does in practice: pnpm hard-links files out of its content-addressed store, so the
 * installed file carries the **store entry's** timestamp and looks older than the artifact by construction.
 * Every pnpm-linked install looked stale, and a banner that cries wolf is worse than no banner. What the plugin
 * states instead is fact: its version, where it was loaded from, and when its own entry was written.
 */
