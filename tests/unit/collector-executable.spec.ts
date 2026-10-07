import { describe, expect, it } from 'vitest'
import { resolvePackagedCollectorExecutable } from '../../src/host/collector/executable.js'

describe('packaged collector executable', () => {
  const moduleUrl = 'file:///tmp/dsh-computer-history/lib/index.js'

  it('selects the packaged collector by runtime platform', () => {
    expect(resolvePackagedCollectorExecutable(moduleUrl, 'darwin'))
      .toBe('/tmp/dsh-computer-history/bin/dsh-computer-history-collector')
    expect(resolvePackagedCollectorExecutable(moduleUrl, 'win32'))
      .toBe('/tmp/dsh-computer-history/bin/dsh-computer-history-collector-windows.exe')
    expect(resolvePackagedCollectorExecutable(moduleUrl, 'linux'))
      .toBe('/tmp/dsh-computer-history/bin/dsh-computer-history-collector-linux')
  })

  it('does not guess a collector on an unsupported platform', () => {
    expect(() => resolvePackagedCollectorExecutable(moduleUrl, 'freebsd'))
      .toThrow('unsupported computer-history collector platform: freebsd')
  })
})
