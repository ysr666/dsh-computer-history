import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SupportedApplicationInventoryReader } from '../../src/host/system/application-inventory.js'

function runtime(found: Readonly<Record<string, string>> = {}) {
  const specs: Array<{ argv: readonly string[] }> = []
  const resolveExecutable = vi.fn(async (command: string) => command)
  const spawn = vi.fn((spec: { readonly argv: readonly string[] }) => {
    specs.push(spec)
    const query = spec.argv[1] ?? ''
    const bundle = /== '([^']+)'/.exec(query)?.[1] ?? ''
    const stdout = found[bundle] ?? ''
    return {
      done: Promise.resolve({ exitCode: 0, signal: null }),
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

describe('supported application inventory', () => {
  it('does nothing on an unverified platform', async () => {
    const child = runtime()
    const inventory = new SupportedApplicationInventoryReader({
      subprocess: child as never,
      cwd: '/tmp',
      platform: 'linux',
    })
    await expect(inventory.read()).resolves.toEqual({
      available: false,
      applications: [],
      reason: 'platform-unverified',
    })
    expect(child.resolveExecutable).not.toHaveBeenCalled()
    expect(child.spawn).not.toHaveBeenCalled()
  })

  it('returns only installed apps from the fixed supported bundle-id set', async () => {
    const child = runtime({
      'com.microsoft.VSCode': '/Applications/Visual Studio Code.app\n',
      'com.apple.Terminal': '/System/Applications/Utilities/Terminal.app\n',
    })
    const inventory = new SupportedApplicationInventoryReader({
      subprocess: child as never,
      cwd: '/tmp',
      platform: 'darwin',
    })
    const result = await inventory.read()
    expect(result).toEqual({
      available: true,
      applications: [
        {
          bundleId: 'com.apple.Terminal',
          name: 'Terminal',
          surfaceKind: 'terminal',
        },
        {
          bundleId: 'com.microsoft.VSCode',
          name: 'Visual Studio Code',
          surfaceKind: 'editor',
        },
      ],
    })
    expect(child.resolveExecutable).toHaveBeenCalledWith('/usr/bin/mdfind')
    for (const spec of child.specs) {
      expect(spec.argv[0]).toBe('/usr/bin/mdfind')
      expect(spec.argv).toHaveLength(2)
      expect(spec.argv[1]).toMatch(/^kMDItemCFBundleIdentifier == '[A-Za-z0-9._-]+'$/)
      expect(spec.argv[1]).not.toContain('companion.browser')
      expect(spec.argv[1]).not.toMatch(/\.exe'$/)
      expect(spec.argv[1]).not.toMatch(/\.desktop'$/)
    }
  })

  it('returns a cached PNG icon only for a supported installed app', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-icon-'))
    try {
      const appPath = path.join(root, 'Visual Studio Code.app')
      const resources = path.join(appPath, 'Contents', 'Resources')
      mkdirSync(resources, { recursive: true })
      writeFileSync(path.join(resources, 'Code.icns'), Buffer.from('fake-icns'))

      const specs: Array<{ argv: readonly string[] }> = []
      let iconOutputPath: string | undefined
      const subprocess = {
        resolveExecutable: vi.fn(async (command: string) => command),
        spawn: vi.fn((spec: { readonly argv: readonly string[] }) => {
          specs.push(spec)
          let stdout = ''
          if (spec.argv[0] === '/usr/bin/mdfind') {
            const bundle = /== '([^']+)'/.exec(spec.argv[1] ?? '')?.[1]
            if (bundle === 'com.microsoft.VSCode') {
              stdout = appPath + '\n'
            }
          } else if (spec.argv[0] === '/usr/libexec/PlistBuddy') {
            stdout = 'Code.icns\n'
          } else if (spec.argv[0] === '/usr/bin/sips') {
            const outIndex = spec.argv.indexOf('--out')
            iconOutputPath = spec.argv[outIndex + 1]
            if (!iconOutputPath) throw new Error('missing icon output path')
            writeFileSync(iconOutputPath, Buffer.from([
              0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
            ]))
          }
          return {
            done: Promise.resolve({ exitCode: 0, signal: null }),
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
        }),
      }
      const inventory = new SupportedApplicationInventoryReader({
        subprocess: subprocess as never,
        cwd: '/tmp',
        platform: 'darwin',
      })

      await expect(inventory.readIcon('not.a.supported.bundle')).resolves.toBeUndefined()
      expect(subprocess.spawn).not.toHaveBeenCalled()

      const first = await inventory.readIcon('com.microsoft.VSCode')
      expect(Array.from(first ?? []).slice(0, 8)).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ])
      expect(specs.some(spec => spec.argv[0] === '/usr/bin/sips')).toBe(true)
      expect(iconOutputPath).toBeDefined()
      expect(existsSync(iconOutputPath!)).toBe(false)

      const calls = subprocess.spawn.mock.calls.length
      await expect(inventory.readIcon('com.microsoft.VSCode')).resolves.toEqual(first)
      expect(subprocess.spawn).toHaveBeenCalledTimes(calls)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })


  it('refuses an app icon symlink that escapes the app Resources directory', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-icon-boundary-'))
    try {
      const appPath = path.join(root, 'Visual Studio Code.app')
      const resources = path.join(appPath, 'Contents', 'Resources')
      mkdirSync(resources, { recursive: true })
      const outside = path.join(root, 'private.png')
      writeFileSync(outside, Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]))
      symlinkSync(outside, path.join(resources, 'Code.icns'))

      const specs: Array<{ argv: readonly string[] }> = []
      const subprocess = {
        resolveExecutable: vi.fn(async (command: string) => command),
        spawn: vi.fn((spec: { readonly argv: readonly string[] }) => {
          specs.push(spec)
          let stdout = ''
          if (spec.argv[0] === '/usr/bin/mdfind') {
            const bundle = /== '([^']+)'/.exec(spec.argv[1] ?? '')?.[1]
            if (bundle === 'com.microsoft.VSCode') stdout = appPath + '\n'
          } else if (spec.argv[0] === '/usr/libexec/PlistBuddy') {
            stdout = 'Code.icns\n'
          }
          return {
            done: Promise.resolve({ exitCode: 0, signal: null }),
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
        }),
      }
      const inventory = new SupportedApplicationInventoryReader({
        subprocess: subprocess as never,
        cwd: '/tmp',
        platform: 'darwin',
      })

      await expect(inventory.readIcon('com.microsoft.VSCode')).resolves.toBeUndefined()
      expect(specs.some(spec => spec.argv[0] === '/usr/bin/sips')).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('bounds native inventory commands with a caller-owned abort signal', async () => {
    const signals: AbortSignal[] = []
    const subprocess = {
      resolveExecutable: vi.fn(async (command: string) => command),
      spawn: vi.fn((spec: { readonly signal?: AbortSignal }) => {
        if (!spec.signal) throw new Error('missing command deadline')
        signals.push(spec.signal)
        return {
          done: new Promise<{ exitCode: null, signal: 'SIGTERM' }>(resolve => {
            spec.signal?.addEventListener('abort', () => {
              resolve({ exitCode: null, signal: 'SIGTERM' })
            }, { once: true })
          }),
          collected: {
            stdout: {
              readFrom: () => ({ text: '', nextOffset: 0, lossy: false }),
            },
          },
        }
      }),
    }
    const inventory = new SupportedApplicationInventoryReader({
      subprocess: subprocess as never,
      cwd: '/tmp',
      platform: 'darwin',
      commandTimeoutMs: 5,
    })

    await expect(inventory.read()).resolves.toEqual({
      available: true,
      applications: [],
    })
    expect(signals.length).toBeGreaterThan(0)
    expect(signals.every(signal => signal.aborted)).toBe(true)
  })

  it('coalesces repeated reads into one inventory probe', async () => {
    const child = runtime({
      'com.apple.Terminal': '/System/Applications/Utilities/Terminal.app\n',
    })
    const inventory = new SupportedApplicationInventoryReader({
      subprocess: child as never,
      cwd: '/tmp',
      platform: 'darwin',
    })
    await Promise.all([inventory.read(), inventory.read()])
    const calls = child.spawn.mock.calls.length
    await inventory.read()
    expect(child.spawn).toHaveBeenCalledTimes(calls)
  })
})
