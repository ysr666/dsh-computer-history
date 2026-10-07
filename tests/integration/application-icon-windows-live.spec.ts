import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { SupportedApplicationInventoryReader } from '../../src/host/system/application-inventory.js'

function liveSubprocess() {
  return {
    resolveExecutable: async (command: string) => command,
    spawn(spec: {
      readonly argv: readonly string[]
      readonly cwd: string
    }) {
      const [command, ...args] = spec.argv
      if (!command) throw new Error('missing subprocess command')
      const completed = spawnSync(command, args, {
        cwd: spec.cwd,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      })
      const stdout = completed.stdout ?? ''
      const stderr = completed.stderr ?? ''
      return {
        done: Promise.resolve({
          exitCode: completed.status ?? 1,
          signal: completed.signal,
        }),
        collected: {
          stdout: {
            readFrom: () => ({
              text: stdout,
              nextOffset: Buffer.byteLength(stdout),
              lossy: false,
            }),
          },
          stderr: {
            readFrom: () => ({
              text: stderr,
              nextOffset: Buffer.byteLength(stderr),
              lossy: false,
            }),
          },
        },
      }
    },
  }
}

describe.runIf(process.platform === 'win32')('Windows native application icon live probe', () => {
  it('extracts the real Notepad executable icon as PNG', async () => {
    const inventory = new SupportedApplicationInventoryReader({
      subprocess: liveSubprocess() as never,
      cwd: process.cwd(),
      platform: 'win32',
      commandTimeoutMs: 10_000,
    })

    const icon = await inventory.readIcon('Notepad.exe')
    expect(icon).toBeDefined()
    expect(Array.from(icon ?? []).slice(0, 8)).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])
    expect((icon?.byteLength ?? 0)).toBeGreaterThan(128)
  })
})
