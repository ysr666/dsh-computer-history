import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  COMPUTER_HISTORY_PACKAGE,
  computerHistoryPluginNavigation,
} from '../../src/client/plugin-navigation.js'

describe('official DSH plugin navigation', () => {
  it('opens this package through the reflected Plugins navigation service', () => {
    const openBundle = vi.fn()
    const ctx = { reflect: { get: vi.fn(() => ({ openBundle })) } } as unknown as Pick<Context, 'reflect'>
    const navigation = computerHistoryPluginNavigation(ctx)
    expect(navigation).toBeDefined()
    navigation?.open()
    expect(openBundle).toHaveBeenCalledWith(COMPUTER_HISTORY_PACKAGE)
    expect(ctx.reflect.get).toHaveBeenCalledWith('pluginNavigation', true)
  })

  it('disappears honestly when the Host has no official plugin manager navigation', () => {
    const ctx = { reflect: { get: () => undefined } } as unknown as Pick<Context, 'reflect'>
    expect(computerHistoryPluginNavigation(ctx)).toBeUndefined()
  })
})
