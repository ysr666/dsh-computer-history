import path from 'node:path'
import os from 'node:os'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import {
  PHASE1_ADAPTERS,
  type SupportedApplication,
  type SupportedApplicationInventory,
} from '../../shared/index.js'

type SubprocessFace = Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>

export interface ApplicationInventoryOptions {
  readonly subprocess: SubprocessFace
  readonly cwd: string
  readonly platform?: NodeJS.Platform
  /** Caller-owned command deadline; exposed only so timeout behavior is testable. */
  readonly commandTimeoutMs?: number
}

const DEFAULT_COMMAND_TIMEOUT_MS = 2_000

function macBundleCandidates(): readonly {
  readonly bundleId: string
  readonly surfaceKind: SupportedApplication['surfaceKind']
}[] {
  return PHASE1_ADAPTERS.flatMap(adapter =>
    adapter.bundleIds
      .filter(bundleId =>
        bundleId !== 'companion.browser'
        && !bundleId.endsWith('.exe')
        && !bundleId.endsWith('.desktop'),
      )
      .map(bundleId => ({ bundleId, surfaceKind: adapter.surfaceKind })),
  )
}

function applicationName(appPath: string): string {
  const basename = path.basename(appPath)
  return basename.toLowerCase().endsWith('.app')
    ? basename.slice(0, -4)
    : basename
}

/**
 * Product-facing inventory of applications this build can actually understand.
 *
 * macOS Spotlight is queried only for the fixed bundle identifiers in the
 * adapter table. No user path, search text, document name or window content is
 * accepted as input. Other platforms stay unavailable until their inventory
 * mechanism is live-verified instead of guessed.
 */
export class SupportedApplicationInventoryReader {
  private readonly subprocess: SubprocessFace
  private readonly cwd: string
  private readonly platform: NodeJS.Platform
  private readonly commandTimeoutMs: number
  private promise: Promise<SupportedApplicationInventory> | undefined
  private readonly appPaths = new Map<string, string>()
  private readonly iconCache = new Map<string, Uint8Array>()

  public constructor(options: ApplicationInventoryOptions) {
    this.subprocess = options.subprocess
    this.cwd = options.cwd
    this.platform = options.platform ?? process.platform
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
  }

  private async runCommand(
    argv: readonly string[],
    outputLimit: number,
  ): Promise<{ readonly stdout: string } | undefined> {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, this.commandTimeoutMs)
    try {
      const handle = this.subprocess.spawn({
        argv,
        cwd: this.cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: outputLimit },
          stderr: { maxBytes: Math.min(outputLimit, 16 * 1024) },
        },
        graceMs: Math.min(this.commandTimeoutMs, 2_000),
        signal: controller.signal,
      })
      const outcome = await handle.done
      if (controller.signal.aborted || outcome.exitCode !== 0) return undefined
      return { stdout: handle.collected.stdout?.readFrom(0).text ?? '' }
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }

  public read(): Promise<SupportedApplicationInventory> {
    this.promise ??= this.readNow()
    return this.promise
  }

  private async readNow(): Promise<SupportedApplicationInventory> {
    if (this.platform !== 'darwin') {
      return { available: false, applications: [], reason: 'platform-unverified' }
    }
    const mdfind = await this.subprocess.resolveExecutable('/usr/bin/mdfind')
      .catch(() => undefined)
    if (!mdfind) {
      return { available: false, applications: [], reason: 'inventory-unavailable' }
    }

    const applications = (await Promise.all(
      macBundleCandidates().map(async candidate => {
        try {
          const query = `kMDItemCFBundleIdentifier == '${candidate.bundleId}'`
          const result = await this.runCommand([mdfind, query], 64 * 1024)
          if (!result) return undefined
          const stdout = result.stdout
          const appPath = stdout
            .split(/\r?\n/)
            .map(line => line.trim())
            .find(line => line.toLowerCase().endsWith('.app'))
          if (!appPath) return undefined
          this.appPaths.set(candidate.bundleId, appPath)
          return {
            bundleId: candidate.bundleId,
            name: applicationName(appPath),
            surfaceKind: candidate.surfaceKind,
          } satisfies SupportedApplication
        } catch {
          return undefined
        }
      }),
    ))
      .filter((item): item is SupportedApplication => item !== undefined)
      .toSorted((left, right) => left.name.localeCompare(right.name))

    return { available: true, applications }
  }

  /**
   * Return a small system-provided application icon for a supported installed
   * macOS bundle. The renderer supplies only a fixed supported bundle id; app
   * paths never cross the Host boundary. Conversion uses the OS-owned `sips`
   * binary and a private temporary directory which is removed immediately.
   */
  public async readIcon(bundleId: string): Promise<Uint8Array | undefined> {
    if (this.platform !== 'darwin') return undefined
    if (!macBundleCandidates().some(candidate => candidate.bundleId === bundleId)) {
      return undefined
    }
    const cached = this.iconCache.get(bundleId)
    if (cached) return cached

    await this.read()
    const appPath = this.appPaths.get(bundleId)
    if (!appPath) return undefined

    const plistBuddy = await this.subprocess
      .resolveExecutable('/usr/libexec/PlistBuddy')
      .catch(() => undefined)
    const sips = await this.subprocess
      .resolveExecutable('/usr/bin/sips')
      .catch(() => undefined)
    if (!plistBuddy || !sips) return undefined

    const infoPlist = path.join(appPath, 'Contents', 'Info.plist')
    const iconName = await this.readPlistIconName(plistBuddy, infoPlist)
    if (!iconName) return undefined
    const iconFile = iconName.toLowerCase().endsWith('.icns')
      ? iconName
      : `${iconName}.icns`
    const resourcesDirectory = path.join(appPath, 'Contents', 'Resources')
    const iconPath = path.join(resourcesDirectory, iconFile)
    // The plist value is app-controlled metadata. Reject symlinks that escape
    // the app bundle as well as lexical traversal: otherwise a bundle claiming
    // a supported id could make the icon endpoint convert arbitrary local
    // image content, violating the metadata-only boundary.
    let containedIconPath: string
    try {
      const [resolvedResources, resolvedIcon] = await Promise.all([
        realpath(resourcesDirectory),
        realpath(iconPath),
      ])
      const relative = path.relative(resolvedResources, resolvedIcon)
      if (
        relative === ''
        || relative === '..'
        || relative.startsWith('..' + path.sep)
        || path.isAbsolute(relative)
      ) return undefined
      containedIconPath = resolvedIcon
    } catch {
      return undefined
    }

    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'dsh-computer-history-icon-'))
    const outputPath = path.join(temporaryDirectory, 'icon.png')
    try {
      const converted = await this.runCommand([
        sips,
        '-s', 'format', 'png',
        '-z', '64', '64',
        containedIconPath,
        '--out', outputPath,
      ], 16 * 1024)
      if (!converted) return undefined
      const bytes = new Uint8Array(await readFile(outputPath))
      // A PNG signature is cheap validation against a tool error page or an
      // unexpected output format before bytes are exposed as image/png.
      if (
        bytes.byteLength < 8
        || bytes[0] !== 0x89
        || bytes[1] !== 0x50
        || bytes[2] !== 0x4e
        || bytes[3] !== 0x47
      ) return undefined
      this.iconCache.set(bundleId, bytes)
      return bytes
    } catch {
      return undefined
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async readPlistIconName(
    plistBuddy: string,
    infoPlist: string,
  ): Promise<string | undefined> {
    const values = await Promise.all(
      (['CFBundleIconFile', 'CFBundleIconName'] as const).map(async key => {
        try {
          const result = await this.runCommand(
            [plistBuddy, '-c', `Print :${key}`, infoPlist],
            4 * 1024,
          )
          if (!result) return undefined
          const value = result.stdout.trim()
          return value && !value.includes('/') && !value.includes('\\')
            ? value
            : undefined
        } catch {
          return undefined
        }
      }),
    )
    return values.find((value): value is string => value !== undefined)
  }

}
