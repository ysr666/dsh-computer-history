import path from 'node:path'
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
}

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
  private promise: Promise<SupportedApplicationInventory> | undefined

  public constructor(options: ApplicationInventoryOptions) {
    this.subprocess = options.subprocess
    this.cwd = options.cwd
    this.platform = options.platform ?? process.platform
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
          const handle = this.subprocess.spawn({
            argv: [mdfind, query],
            cwd: this.cwd,
            stdio: {
              stdin: 'ignore',
              stdout: { maxBytes: 64 * 1024 },
              stderr: { maxBytes: 16 * 1024 },
            },
            graceMs: 2_000,
          })
          const outcome = await handle.done
          if (outcome.exitCode !== 0) return undefined
          const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
          const appPath = stdout
            .split(/\r?\n/)
            .map(line => line.trim())
            .find(line => line.toLowerCase().endsWith('.app'))
          if (!appPath) return undefined
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
}
