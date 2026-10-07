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
  readonly environment?: NodeJS.ProcessEnv
  /** Caller-owned command deadline; exposed so native-icon behavior is testable. */
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

function windowsBundleCandidates(): readonly string[] {
  return PHASE1_ADAPTERS
    .flatMap(adapter => adapter.bundleIds)
    .filter(bundleId => /\.exe$/i.test(bundleId))
}

function linuxBundleCandidates(): readonly string[] {
  return PHASE1_ADAPTERS
    .flatMap(adapter => adapter.bundleIds)
    .filter(bundleId => bundleId.endsWith('.desktop'))
}

function containedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith('..' + path.sep)
    && !path.isAbsolute(relative)
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
}

function desktopIconName(contents: string): string | undefined {
  let inDesktopEntry = false
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[') && line.endsWith(']')) {
      if (inDesktopEntry) break
      inDesktopEntry = line === '[Desktop Entry]'
      continue
    }
    if (!inDesktopEntry || !line.startsWith('Icon=')) continue
    const value = line.slice('Icon='.length).trim()
    return value || undefined
  }
  return undefined
}

function powershellLiteral(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'"
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
  private readonly environment: NodeJS.ProcessEnv
  private readonly commandTimeoutMs: number
  private promise: Promise<SupportedApplicationInventory> | undefined
  private readonly appPaths = new Map<string, string>()
  private readonly iconCache = new Map<string, Uint8Array>()

  public constructor(options: ApplicationInventoryOptions) {
    this.subprocess = options.subprocess
    this.cwd = options.cwd
    this.platform = options.platform ?? process.platform
    this.environment = options.environment ?? process.env
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
    if (this.promise) return this.promise

    const running = this.readNow()
    this.promise = running
    void running.then(
      () => {
        if (this.promise === running) this.promise = undefined
      },
      () => {
        if (this.promise === running) this.promise = undefined
      },
    )
    return running
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

    this.appPaths.clear()
    const applications = (await Promise.all(
      macBundleCandidates().map(async candidate => {
        try {
          const query = `kMDItemCFBundleIdentifier == '${candidate.bundleId}'`
          const result = await this.runCommand([mdfind, query], 64 * 1024)
          if (!result) return undefined
          const appPath = result.stdout
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
   * Return a small OS-provided application icon for a supported identity.
   *
   * macOS reads the installed bundle's .icns, Windows extracts the associated
   * executable icon through the Windows shell/System.Drawing bridge, and Linux
   * follows the Desktop Entry Icon key into standard hicolor/pixmaps roots.
   * Every path begins from the fixed adapter inventory; arbitrary ids are
   * refused before touching the filesystem or spawning a converter.
   */
  public async readIcon(bundleId: string): Promise<Uint8Array | undefined> {
    const cacheKey = this.platform === 'win32'
      ? bundleId.toLowerCase()
      : bundleId
    const cached = this.iconCache.get(cacheKey)
    if (cached) return cached

    const bytes = this.platform === 'darwin'
      ? await this.readMacIcon(bundleId)
      : this.platform === 'win32'
        ? await this.readWindowsIcon(bundleId)
        : this.platform === 'linux'
          ? await this.readLinuxIcon(bundleId)
          : undefined
    if (bytes) this.iconCache.set(cacheKey, bytes)
    return bytes
  }

  private async readMacIcon(bundleId: string): Promise<Uint8Array | undefined> {
    if (!macBundleCandidates().some(candidate => candidate.bundleId === bundleId)) {
      return undefined
    }

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

    let containedIconPath: string
    try {
      const [resolvedResources, resolvedIcon] = await Promise.all([
        realpath(resourcesDirectory),
        realpath(iconPath),
      ])
      if (!containedPath(resolvedResources, resolvedIcon)) return undefined
      containedIconPath = resolvedIcon
    } catch {
      return undefined
    }

    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'dsh-computer-history-icon-'),
    )
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
      return await this.readPng(outputPath)
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async readWindowsIcon(bundleId: string): Promise<Uint8Array | undefined> {
    const executableName = windowsBundleCandidates()
      .find(candidate => candidate.toLowerCase() === bundleId.toLowerCase())
    if (!executableName) return undefined

    const powershell = await this.subprocess.resolveExecutable('powershell.exe')
      .catch(async () => this.subprocess.resolveExecutable('pwsh.exe')
        .catch(() => undefined))
    if (!powershell) return undefined

    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'dsh-computer-history-icon-'),
    )
    const outputPath = path.join(temporaryDirectory, 'icon.png')
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$name = ${powershellLiteral(executableName)}`,
      `$output = ${powershellLiteral(outputPath)}`,
      '$candidates = @()',
      '$command = Get-Command -Name $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1',
      'if ($command) { $candidates += $command.Source }',
      "foreach ($root in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths')) {",
      "  try { $value = (Get-Item -LiteralPath (Join-Path $root $name) -ErrorAction Stop).GetValue(''); if ($value) { $candidates += [Environment]::ExpandEnvironmentVariables([string]$value) } } catch {}",
      '}',
      "if ($env:WINDIR) { $candidates += (Join-Path (Join-Path $env:WINDIR 'System32') $name); $candidates += (Join-Path $env:WINDIR $name) }",
      '$target = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1',
      'if (-not $target) { exit 2 }',
      'Add-Type -AssemblyName System.Drawing',
      '$icon = [System.Drawing.Icon]::ExtractAssociatedIcon([string]$target)',
      'if (-not $icon) { exit 3 }',
      '$bitmap = $null',
      'try {',
      '  $bitmap = $icon.ToBitmap()',
      '  $bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)',
      '} finally {',
      '  if ($bitmap) { $bitmap.Dispose() }',
      '  $icon.Dispose()',
      '}',
    ].join('; ')

    try {
      const converted = await this.runCommand([
        powershell,
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command', script,
      ], 16 * 1024)
      if (!converted) return undefined
      return await this.readPng(outputPath)
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {})
    }
  }

  private linuxDataRoots(): readonly string[] {
    const home = this.environment.HOME
    const userRoot = this.environment.XDG_DATA_HOME
      || (home ? path.join(home, '.local', 'share') : undefined)
    const systemRoots = (this.environment.XDG_DATA_DIRS || '/usr/local/share:/usr/share')
      .split(':')
      .filter(Boolean)
    return [...new Set([
      ...(userRoot ? [userRoot] : []),
      ...systemRoots,
    ].map(root => path.resolve(root)))]
  }

  private async readLinuxIcon(bundleId: string): Promise<Uint8Array | undefined> {
    if (!linuxBundleCandidates().includes(bundleId)) return undefined

    const dataRoots = this.linuxDataRoots()
    let desktopContents: string | undefined
    for (const root of dataRoots) {
      const applicationsRoot = path.join(root, 'applications')
      const candidate = path.join(applicationsRoot, bundleId)
      try {
        const [resolvedRoot, resolvedCandidate] = await Promise.all([
          realpath(applicationsRoot),
          realpath(candidate),
        ])
        if (!containedPath(resolvedRoot, resolvedCandidate)) continue
        desktopContents = await readFile(resolvedCandidate, 'utf8')
        break
      } catch {
        // Continue through the XDG search path.
      }
    }
    if (!desktopContents) return undefined

    const iconName = desktopIconName(desktopContents)
    if (!iconName) return undefined
    const iconPath = await this.resolveLinuxPng(iconName, dataRoots)
    if (!iconPath) return undefined
    return this.readPng(iconPath)
  }

  private async resolveLinuxPng(
    iconName: string,
    dataRoots: readonly string[],
  ): Promise<string | undefined> {
    const permittedRoots = dataRoots.flatMap(root => [
      path.join(root, 'icons'),
      path.join(root, 'pixmaps'),
    ])

    if (path.isAbsolute(iconName)) {
      try {
        const resolvedIcon = await realpath(iconName)
        for (const root of permittedRoots) {
          try {
            const resolvedRoot = await realpath(root)
            if (containedPath(resolvedRoot, resolvedIcon)) return resolvedIcon
          } catch {
            // Missing icon roots are ordinary on a minimal installation.
          }
        }
      } catch {
        return undefined
      }
      return undefined
    }

    if (iconName.includes('/') || iconName.includes('\\')) return undefined
    const fileName = iconName.toLowerCase().endsWith('.png')
      ? iconName
      : `${iconName}.png`
    const sizes = ['64x64', '48x48', '32x32', '128x128', '256x256', '512x512']

    for (const root of dataRoots) {
      const candidates = [
        ...sizes.map(size => path.join(root, 'icons', 'hicolor', size, 'apps', fileName)),
        path.join(root, 'pixmaps', fileName),
      ]
      for (const candidate of candidates) {
        try {
          const resolved = await realpath(candidate)
          const iconRoot = candidate.includes(path.join('icons', 'hicolor'))
            ? path.join(root, 'icons')
            : path.join(root, 'pixmaps')
          const resolvedRoot = await realpath(iconRoot)
          if (containedPath(resolvedRoot, resolved)) return resolved
        } catch {
          // Try the next standard icon location.
        }
      }
    }
    return undefined
  }

  private async readPng(iconPath: string): Promise<Uint8Array | undefined> {
    try {
      const bytes = new Uint8Array(await readFile(iconPath))
      return isPng(bytes) ? bytes : undefined
    } catch {
      return undefined
    }
  }

  private async readPlistIconName(
    plistBuddy: string,
    infoPlist: string,
  ): Promise<string | undefined> {
    for (const key of ['CFBundleIconFile', 'CFBundleIconName'] as const) {
      const result = await this.runCommand(
        [plistBuddy, '-c', `Print :${key}`, infoPlist],
        4 * 1024,
      )
      if (!result) continue
      const value = result.stdout.trim()
      if (value && !value.includes('/') && !value.includes('\\')) return value
    }
    return undefined
  }
}
