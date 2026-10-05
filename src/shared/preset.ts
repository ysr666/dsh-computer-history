import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
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
  /**
   * Set when the profile's installed copy no longer matches the artifact it installed: the artifact was
   * rebuilt and the profile still runs the previous extraction. Compared by content, never by time.
   */
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
 * Does the profile that installed this copy still match the artifact it installed?
 *
 * The failure this catches has already cost this phase twice: the plugin is changed and built, the profile
 * still runs the previous copy, and the result looks exactly like a broken feature. The plugin can work it out
 * without any help - it knows where it was loaded from, it can find the profile whose node_modules resolves to
 * that directory, and pnpm recorded what the artifact looked like when it installed it.
 *
 * That last part is the whole trick. An earlier version of this compared timestamps and was removed for crying
 * wolf: pnpm hard-links installed files out of its content-addressed store, so the installed file carries the
 * store entry's timestamp and looks older than the artifact by construction - every install looked stale. The
 * digest pnpm wrote into the profile's lockfile cannot be fooled that way: hard links share content, not time.
 * When the lockfile says nothing, this says nothing.
 */
export function findStaleInstall(
  loadedFrom: string,
  profilesRoot: string,
): RunningRelease['stale'] {
  if (!existsSync(profilesRoot)) return undefined
  let profiles: string[]
  try {
    profiles = readdirSync(profilesRoot)
  } catch {
    return undefined
  }

  for (const profile of profiles) {
    const manifestPath = path.join(profilesRoot, profile, 'package.json')
    if (!existsSync(manifestPath)) continue
    let spec: unknown
    try {
      const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
      spec = (manifest as { dependencies?: Record<string, unknown> })
        .dependencies?.['dsh-computer-history']
    } catch {
      continue
    }
    if (typeof spec !== 'string' || !spec.startsWith('file:')) continue

    const installed = path.join(profilesRoot, profile, 'node_modules', 'dsh-computer-history')
    let resolved: string
    try {
      resolved = realpathSync(installed)
    } catch {
      continue
    }
    if (path.resolve(resolved) !== path.resolve(loadedFrom)) continue

    const artifact = path.resolve(path.dirname(manifestPath), spec.slice('file:'.length))
    if (!existsSync(artifact)) continue

    let recorded: string | undefined
    try {
      recorded = recordedIntegrity(
        readFileSync(path.join(profilesRoot, profile, 'pnpm-lock.yaml'), 'utf8'),
      )
    } catch {
      recorded = undefined
    }
    if (recorded === undefined) continue

    let actual: string
    try {
      actual = `sha512-${createHash('sha512').update(readFileSync(artifact)).digest('base64')}`
    } catch {
      continue
    }
    if (actual === recorded) continue

    return {
      profile,
      artifact,
      artifactAtMs: Math.round(statSync(artifact).mtimeMs),
      updateCommand: `dsh plugin --profile ${profile} add ${artifact}`,
    }
  }
  return undefined
}

/**
 * The integrity pnpm recorded for the plugin's own entry.
 *
 * A YAML parser would be a dependency, and this needs one value out of one entry, so it reads that entry the way
 * pnpm writes it and answers `undefined` when the shape is not what it expects. Saying nothing is always safe
 * here; guessing is what made the previous version useless.
 */
function recordedIntegrity(lockfile: string): string | undefined {
  const lines = lockfile.split('\n')
  for (let index = 0; index < lines.length; index++) {
    if (!/^ {2}dsh-computer-history@/.test(lines[index] ?? '')) continue
    for (let cursor = index; cursor < lines.length && cursor < index + 24; cursor++) {
      const line = lines[cursor] ?? ''
      if (cursor > index && /^ {2}\S/.test(line)) break
      const match = /integrity:\s*(sha512-[A-Za-z0-9+/=]+)/.exec(line)
      if (match) return match[1]
    }
  }
  return undefined
}
