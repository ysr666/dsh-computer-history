import { describe, expect, it, vi } from 'vitest'
import {
  EDITOR_COMPANION_EXTENSION_ID,
  EDITOR_COMPANION_VERSION,
  EditorCompanionInstaller,
} from '../../src/host/companion/editor-install.js'

function runtime(options: {
  readonly listed?: string
  readonly listExitCode?: number
  readonly installExitCode?: number
  readonly codeUnavailable?: boolean
} = {}) {
  const specs: unknown[] = []
  const resolveExecutable = vi.fn(async (command: string): Promise<string | undefined> =>
    command === 'code'
      ? options.codeUnavailable ? undefined : '/resolved/code'
      : `/resolved/${command}`,
  )
  const spawn = vi.fn((spec: {
    readonly argv: readonly string[]
  }) => {
    specs.push(spec)
    const listing = spec.argv.includes('--list-extensions')
    const exitCode = listing
      ? options.listExitCode ?? 0
      : options.installExitCode ?? 0
    const stdout = listing ? options.listed ?? '' : 'installed\n'
    return {
      done: Promise.resolve({ exitCode, signal: null }),
      collected: {
        stdout: {
          readFrom: () => ({
            text: stdout,
            nextOffset: Buffer.byteLength(stdout),
            lossy: false,
          }),
        },
      },
    }
  })
  return { resolveExecutable, spawn, specs }
}

describe('EditorCompanionInstaller', () => {
  it('does not probe or run commands on an unverified platform', async () => {
    const child = runtime()
    const installer = new EditorCompanionInstaller({
      subprocess: child as never,
      cwd: '/tmp',
      vsixPath: '/tmp/editor.vsix',
      platform: 'linux',
      exists: () => true,
    })

    await expect(installer.capability()).resolves.toEqual({
      available: false,
      installed: false,
      reason: 'platform-unverified',
    })
    expect(child.resolveExecutable).not.toHaveBeenCalled()
    expect(child.spawn).not.toHaveBeenCalled()
  })

  it('requires the bundled VSIX before offering one-click install', async () => {
    const child = runtime()
    const installer = new EditorCompanionInstaller({
      subprocess: child as never,
      cwd: '/tmp',
      vsixPath: '/tmp/missing.vsix',
      platform: 'darwin',
      exists: () => false,
    })

    await expect(installer.capability()).resolves.toEqual({
      available: false,
      installed: false,
      reason: 'package-missing',
    })
    expect(child.resolveExecutable).not.toHaveBeenCalled()
  })

  it('recovers when the VS Code CLI appears after an earlier unavailable probe', async () => {
    let available = false
    const resolveExecutable = vi.fn(async (command: string) =>
      command === 'code' && available ? '/resolved/code' : undefined)
    const spawn = vi.fn(() => ({
      done: Promise.resolve({ exitCode: 0, signal: null }),
      collected: {
        stdout: {
          readFrom: () => ({
            text: '',
            nextOffset: 0,
            lossy: false,
          }),
        },
      },
    }))
    const installer = new EditorCompanionInstaller({
      subprocess: { resolveExecutable, spawn } as never,
      cwd: '/tmp',
      vsixPath: '/tmp/editor.vsix',
      platform: 'darwin',
      exists: candidate => candidate === '/tmp/editor.vsix',
      homeDirectory: '/Users/tester',
    })

    await expect(installer.capability()).resolves.toEqual({
      available: false,
      installed: false,
      reason: 'code-cli-unavailable',
    })
    expect(resolveExecutable).toHaveBeenCalledTimes(1)
    expect(spawn).not.toHaveBeenCalled()

    available = true
    await expect(installer.capability()).resolves.toEqual({
      available: true,
      installed: false,
    })
    expect(resolveExecutable).toHaveBeenCalledTimes(2)
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('detects the installed extension through the fixed VS Code CLI query', async () => {
    const child = runtime({
      listed: `${EDITOR_COMPANION_EXTENSION_ID}@0.1.0\nother.extension@1.0.0\n`,
    })
    const installer = new EditorCompanionInstaller({
      subprocess: child as never,
      cwd: '/tmp',
      vsixPath: '/tmp/editor.vsix',
      platform: 'darwin',
      exists: () => true,
    })

    await expect(installer.capability()).resolves.toEqual({
      available: true,
      installed: true,
      installedVersion: '0.1.0',
      bundledVersion: EDITOR_COMPANION_VERSION,
      updateAvailable: false,
    })
    expect(child.resolveExecutable).toHaveBeenCalledWith('code')
    expect((child.specs[0] as { argv: readonly string[] }).argv).toEqual([
      '/resolved/code', '--list-extensions', '--show-versions',
    ])
  })



  it('uses the VS Code app-bundle CLI when the shell command is not installed', async () => {
    const child = runtime({ codeUnavailable: true, listed: '' })
    const appCli = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
    const installer = new EditorCompanionInstaller({
      subprocess: child as never,
      cwd: '/tmp',
      vsixPath: '/tmp/editor.vsix',
      platform: 'darwin',
      homeDirectory: '/Users/tester',
      exists: candidate => candidate === '/tmp/editor.vsix' || candidate === appCli,
    })

    await expect(installer.capability()).resolves.toEqual({
      available: true,
      installed: false,
    })
    expect((child.specs[0] as { argv: readonly string[] }).argv).toEqual([
      appCli, '--list-extensions', '--show-versions',
    ])
  })

  it('installs only the Host-owned VSIX with explicit argv and no shell', async () => {
    const child = runtime({ listed: '' })
    const installer = new EditorCompanionInstaller({
      subprocess: child as never,
      cwd: '/tmp',
      vsixPath: '/opt/plugin/dsh-computer-history-editor.vsix',
      platform: 'darwin',
      exists: () => true,
    })

    await expect(installer.install()).resolves.toEqual({ status: 'installed' })
    expect(child.spawn).toHaveBeenCalledTimes(2)
    const install = child.specs[1] as {
      argv: readonly string[]
      env?: NodeJS.ProcessEnv
    }
    expect(install.argv).toEqual([
      '/resolved/code',
      '--install-extension',
      '/opt/plugin/dsh-computer-history-editor.vsix',
      '--force',
    ])
    expect(install.env).toEqual({ ELECTRON_RUN_AS_NODE: undefined })
  })

  it('does not reinstall an already installed companion', async () => {
    const child = runtime({ listed: `${EDITOR_COMPANION_EXTENSION_ID}@${EDITOR_COMPANION_VERSION}\n` })
    const installer = new EditorCompanionInstaller({
      subprocess: child as never,
      cwd: '/tmp',
      vsixPath: '/tmp/editor.vsix',
      platform: 'darwin',
      exists: () => true,
    })

    await expect(installer.install()).resolves.toEqual({ status: 'already-installed' })
    expect(child.spawn).toHaveBeenCalledTimes(1)
  })



  it('reinstalls an older installed companion as an update', async () => {
    const child = runtime({ listed: `${EDITOR_COMPANION_EXTENSION_ID}@0.0.9\n` })
    const installer = new EditorCompanionInstaller({
      subprocess: child as never,
      cwd: '/tmp',
      vsixPath: '/opt/plugin/dsh-computer-history-editor.vsix',
      platform: 'darwin',
      exists: () => true,
    })

    await expect(installer.capability()).resolves.toMatchObject({
      available: true,
      installed: true,
      installedVersion: '0.0.9',
      bundledVersion: EDITOR_COMPANION_VERSION,
      updateAvailable: true,
    })
    await expect(installer.install()).resolves.toEqual({ status: 'installed' })
    const install = child.specs.at(-1) as { argv: readonly string[] }
    expect(install.argv).toEqual([
      '/resolved/code',
      '--install-extension',
      '/opt/plugin/dsh-computer-history-editor.vsix',
      '--force',
    ])
  })

  it('keeps the Host companion version in sync with the packaged editor manifest', async () => {
    const { readFile } = await import('node:fs/promises')
    const manifest = JSON.parse(await readFile(
      new URL('../../extension-editor/package.json', import.meta.url),
      'utf8',
    )) as { version?: unknown }
    expect(manifest.version).toBe(EDITOR_COMPANION_VERSION)
  })

  it('reports a CLI install failure without claiming success', async () => {
    const child = runtime({ listed: '', installExitCode: 1 })
    const installer = new EditorCompanionInstaller({
      subprocess: child as never,
      cwd: '/tmp',
      vsixPath: '/tmp/editor.vsix',
      platform: 'darwin',
      exists: () => true,
    })

    await expect(installer.install()).resolves.toEqual({
      status: 'failed',
      reason: 'install-failed',
    })
  })
})
