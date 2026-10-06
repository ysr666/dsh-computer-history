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

  it('coalesces concurrent reads but refreshes a later inventory snapshot', async () => {
    const found: Record<string, string> = {
      'com.apple.Terminal': '/System/Applications/Utilities/Terminal.app\n',
    }
    const child = runtime(found)
    const inventory = new SupportedApplicationInventoryReader({
      subprocess: child as never,
      cwd: '/tmp',
      platform: 'darwin',
    })

    const [first, concurrent] = await Promise.all([
      inventory.read(),
      inventory.read(),
    ])
    expect(concurrent).toEqual(first)
    const firstProbeCalls = child.spawn.mock.calls.length

    found['com.microsoft.VSCode'] = '/Applications/Visual Studio Code.app\n'
    const refreshed = await inventory.read()
    expect(refreshed.applications).toEqual(expect.arrayContaining([
      expect.objectContaining({ bundleId: 'com.microsoft.VSCode' }),
    ]))
    expect(child.spawn.mock.calls.length).toBeGreaterThan(firstProbeCalls)
  })
})
