import { describe, expect, it } from 'vitest'
import { AccessibilitySettingsOpener } from '../../src/host/system/accessibility-settings.js'

function subprocess(exitCode = 0) {
  const calls: string[][] = []
  return {
    calls,
    face: {
      async resolveExecutable(command: string) { return command },
      spawn(input: { readonly argv: readonly string[] }) {
        calls.push([...input.argv])
        return { done: Promise.resolve({ exitCode, signal: null }) }
      },
    },
  }
}

describe('Accessibility Settings fixed action', () => {
  it('is unavailable on an unverified platform without spawning anything', async () => {
    const fake = subprocess()
    const opener = new AccessibilitySettingsOpener({
      subprocess: fake.face as never,
      cwd: '/tmp',
      platform: 'linux',
    })
    await expect(opener.capability()).resolves.toEqual({
      available: false,
      reason: 'platform-unverified',
    })
    await expect(opener.open()).resolves.toEqual({
      status: 'unsupported',
      reason: 'platform-unverified',
    })
    expect(fake.calls).toEqual([])
  })

  it('uses only the fixed macOS opener and verified System Settings URI', async () => {
    const fake = subprocess()
    const opener = new AccessibilitySettingsOpener({
      subprocess: fake.face as never,
      cwd: '/tmp',
      platform: 'darwin',
    })
    await expect(opener.capability()).resolves.toEqual({ available: true })
    await expect(opener.open()).resolves.toEqual({ status: 'opened' })
    expect(fake.calls).toEqual([[
      '/usr/bin/open',
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    ]])
  })

  it('reports launch failure instead of claiming the settings were opened', async () => {
    const fake = subprocess(1)
    const opener = new AccessibilitySettingsOpener({
      subprocess: fake.face as never,
      cwd: '/tmp',
      platform: 'darwin',
    })
    await expect(opener.open()).resolves.toEqual({
      status: 'unsupported',
      reason: 'open-failed',
    })
  })
})
