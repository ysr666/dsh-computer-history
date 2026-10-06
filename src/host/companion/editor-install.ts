import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  EditorCompanionInstallCapability,
  EditorCompanionInstallResult,
} from '../../shared/index.js'

export const EDITOR_COMPANION_EXTENSION_ID = 'dsh-local.dsh-computer-history-editor'
export const EDITOR_COMPANION_VERSION = '0.1.0'

export function bundledEditorCompanionVsix(moduleUrl = import.meta.url): string {
  const moduleDirectory = path.dirname(fileURLToPath(moduleUrl))
  const candidates = [
    // Packaged bundle: <package>/lib/index.js -> <package>/dsh-...vsix
    path.resolve(moduleDirectory, '..', 'dsh-computer-history-editor.vsix'),
    // Source/test execution: src/host/companion/editor-install.ts -> repo root.
    path.resolve(moduleDirectory, '../../..', 'dsh-computer-history-editor.vsix'),
  ]
  return candidates.find(candidate => existsSync(candidate)) ?? candidates[0]!
}

interface EditorCompanionInstallerOptions {
  readonly subprocess: Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>
  readonly cwd: string
  readonly vsixPath: string
  readonly platform?: NodeJS.Platform
  readonly exists?: (path: string) => boolean
  readonly homeDirectory?: string
}

interface CommandResult {
  readonly exitCode: number | null
  readonly stdout: string
}

interface InstalledEditorCompanion {
  readonly installed: boolean
  readonly version?: string
}

/**
 * User-initiated installation of the bundled VS Code companion.
 *
 * This is intentionally narrower than a general command runner: the browser
 * supplies no executable, path, arguments or extension id. The Host resolves
 * `code`, owns the bundled VSIX path and always uses one fixed argv shape.
 */
export class EditorCompanionInstaller {
  private readonly subprocess: EditorCompanionInstallerOptions['subprocess']
  private readonly cwd: string
  private readonly vsixPath: string
  private readonly platform: NodeJS.Platform
  private readonly exists: (path: string) => boolean
  private readonly homeDirectory: string
  private codePath: string | undefined

  public constructor(options: EditorCompanionInstallerOptions) {
    this.subprocess = options.subprocess
    this.cwd = options.cwd
    this.vsixPath = options.vsixPath
    this.platform = options.platform ?? process.platform
    this.exists = options.exists ?? existsSync
    this.homeDirectory = options.homeDirectory ?? os.homedir()
  }

  private async resolveCode(): Promise<string | undefined> {
    if (this.platform !== 'darwin') return undefined
    if (this.codePath) return this.codePath

    const fromPath = await this.subprocess.resolveExecutable('code')
      .catch(() => undefined)
    if (fromPath) {
      this.codePath = fromPath
      return fromPath
    }

    // Installing VS Code's shell command is optional. A normal desktop user
    // should still get the one-click companion path from the app bundle.
    //
    // Do not cache "not found": VS Code or its shell command can appear while
    // this Host keeps running. A failed capability probe must be recoverable
    // without restarting Computer History.
    const suffix = path.join('Contents', 'Resources', 'app', 'bin', 'code')
    const candidates = [
      path.join('/Applications', 'Visual Studio Code.app', suffix),
      path.join(this.homeDirectory, 'Applications', 'Visual Studio Code.app', suffix),
    ]
    const candidate = candidates.find(candidate => this.exists(candidate))
    if (candidate) this.codePath = candidate
    return candidate
  }

  private async run(executable: string, args: readonly string[]): Promise<CommandResult> {
    const handle = this.subprocess.spawn({
      argv: [executable, ...args],
      cwd: this.cwd,
      env: { ELECTRON_RUN_AS_NODE: undefined },
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 128 * 1024 },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 5_000,
    })
    const outcome = await handle.done
    return {
      exitCode: outcome.exitCode,
      stdout: handle.collected.stdout?.readFrom(0).text ?? '',
    }
  }

  private async installed(
    executable: string,
  ): Promise<InstalledEditorCompanion | undefined> {
    try {
      const result = await this.run(executable, ['--list-extensions', '--show-versions'])
      if (result.exitCode !== 0) return undefined
      for (const raw of result.stdout.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line) continue
        const separator = line.lastIndexOf('@')
        const id = (separator >= 0 ? line.slice(0, separator) : line).toLowerCase()
        if (id !== EDITOR_COMPANION_EXTENSION_ID) continue
        const version = separator >= 0 ? line.slice(separator + 1).trim() : ''
        return {
          installed: true,
          ...(version ? { version } : {}),
        }
      }
      return { installed: false }
    } catch {
      return undefined
    }
  }

  public async capability(): Promise<EditorCompanionInstallCapability> {
    if (this.platform !== 'darwin') {
      return { available: false, installed: false, reason: 'platform-unverified' }
    }
    if (!this.exists(this.vsixPath)) {
      return { available: false, installed: false, reason: 'package-missing' }
    }
    const executable = await this.resolveCode()
    if (!executable) {
      return { available: false, installed: false, reason: 'code-cli-unavailable' }
    }
    const installed = await this.installed(executable)
    if (installed === undefined) {
      // A cached executable can disappear or stop launching during a long Host
      // session. Forget it so the next capability check can rediscover a new
      // PATH/app-bundle installation.
      this.codePath = undefined
      return { available: false, installed: false, reason: 'code-cli-unavailable' }
    }
    if (!installed.installed) return { available: true, installed: false }
    const installedVersion = installed.version
    return {
      available: true,
      installed: true,
      ...(installedVersion ? { installedVersion } : {}),
      bundledVersion: EDITOR_COMPANION_VERSION,
      updateAvailable: installedVersion !== EDITOR_COMPANION_VERSION,
    }
  }

  public async install(): Promise<EditorCompanionInstallResult> {
    const capability = await this.capability()
    if (!capability.available) {
      return { status: 'unsupported', ...(capability.reason ? { reason: capability.reason } : {}) }
    }
    if (capability.installed && capability.updateAvailable !== true) {
      return { status: 'already-installed' }
    }

    const executable = await this.resolveCode()
    if (!executable) return { status: 'unsupported', reason: 'code-cli-unavailable' }
    try {
      const result = await this.run(executable, [
        '--install-extension', this.vsixPath, '--force',
      ])
      if (result.exitCode !== 0) return { status: 'failed', reason: 'install-failed' }
      return { status: 'installed' }
    } catch {
      return { status: 'failed', reason: 'install-failed' }
    }
  }
}
