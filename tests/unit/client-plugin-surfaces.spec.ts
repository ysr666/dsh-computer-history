import { describe, expect, it } from 'vitest'
import type { PluginsSubject } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { isComputerHistoryBundleSubject } from '../../src/client/plugin-surfaces.js'

function bundle(name: string): PluginsSubject {
  return {
    kind: 'bundle',
    pkg: {
      name,
      installed: true,
      enabled: true,
      rows: [],
    },
  }
}

describe('Computer History plugin-manager surfaces', () => {
  it('matches only the Computer History bundle detail', () => {
    expect(isComputerHistoryBundleSubject(bundle('dsh-computer-history'))).toBe(true)
    expect(isComputerHistoryBundleSubject(bundle('another-plugin'))).toBe(false)
    expect(isComputerHistoryBundleSubject({ kind: 'item', id: 'computer-history' })).toBe(false)
  })
})
