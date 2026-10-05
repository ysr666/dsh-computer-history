import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  AccessibilitySettingsCapability,
  AccessibilitySettingsOpenResult,
} from '../../shared/index.js'

type SubprocessFace = Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>

export interface AccessibilitySettingsOpenerOptions {
  readonly subprocess: SubprocessFace
  readonly cwd: string
  readonly platform?: NodeJS.Platform
}

// Verified on the user's current macOS installation on 2026-10-04: this opens
// System Settings directly at the permission surface that contains the AX grant.
const MACOS_ACCESSIBILITY_SETTINGS =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'

/** Host-owned fixed action. No browser-supplied URL or executable is accepted. */
export class AccessibilitySettingsOpener {
  private readonly subprocess: SubprocessFace
  private readonly cwd: string
  private readonly platform: NodeJS.Platform
  private openerPromise: Promise<string | undefined> | undefined

  public constructor(options: AccessibilitySettingsOpenerOptions) {
    this.subprocess = options.subprocess
    this.cwd = options.cwd
    this.platform = options.platform ?? process.platform
  }

  private resolveOpener(): Promise<string | undefined> {
    if (this.platform !== 'darwin') return Promise.resolve(undefined)
    this.openerPromise ??= this.subprocess
      .resolveExecutable('/usr/bin/open')
      .catch(() => undefined)
    return this.openerPromise
  }

  public async capability(): Promise<AccessibilitySettingsCapability> {
    if (this.platform !== 'darwin') {
      return { available: false, reason: 'platform-unverified' }
    }
    return await this.resolveOpener()
      ? { available: true }
      : { available: false, reason: 'opener-unavailable' }
  }

  public async open(): Promise<AccessibilitySettingsOpenResult> {
    const capability = await this.capability()
    if (!capability.available) {
      return {
        status: 'unsupported',
        reason: capability.reason ?? 'opener-unavailable',
      }
    }
    const opener = await this.resolveOpener()
    if (!opener) return { status: 'unsupported', reason: 'opener-unavailable' }
    const handle = this.subprocess.spawn({
      argv: [opener, MACOS_ACCESSIBILITY_SETTINGS],
      cwd: this.cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 4_096 },
        stderr: { maxBytes: 4_096 },
      },
      graceMs: 1_000,
    })
    const outcome = await handle.done
    return outcome.exitCode === 0
      ? { status: 'opened' }
      : { status: 'unsupported', reason: 'open-failed' }
  }
}
