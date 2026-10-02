import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import {
  registerComputerHistoryTools,
} from '../../src/agent/index.js'

describe('agent-scoped Computer History surfaces', () => {
  it('keeps canonical tool values structured while rendering an untrusted-data warning', async () => {
    const definitions = new Map<string, ToolDefinition>()
    let recentRequest: { sinceMs?: number; limit?: number } | undefined
    const ctx = {
      tools: {
        register(definition: ToolDefinition) {
          definitions.set(definition.name, definition)
          return () => { definitions.delete(definition.name) }
        },
      },
      computerHistory: {
        recent: async (request: { sinceMs?: number; limit?: number }) => {
          recentRequest = request
          return []
        },
        search: async () => [],
        getEpisode: async () => undefined,
      },
    } as unknown as Context

    const dispose = registerComputerHistoryTools(ctx)
    const recent = definitions.get('computer_history_recent')!
    const before = Date.now() - 10 * 60_000
    const value = await recent.execute(
      { since_minutes: 10, limit: 20 },
      { signal: new AbortController().signal } as never,
    )
    const after = Date.now() - 10 * 60_000
    expect(recentRequest?.limit).toBe(20)
    expect(recentRequest?.sinceMs).toBeGreaterThanOrEqual(before)
    expect(recentRequest?.sinceMs).toBeLessThanOrEqual(after)
    expect(value).toEqual([])
    expect(typeof value).not.toBe('string')

    const rendered = recent.output.render({}, value as never)
    expect(rendered).toHaveLength(2)
    expect(rendered[0]).toMatchObject({
      type: 'text',
    })
    expect(
      (rendered[0] as { text: string }).text,
    ).toContain('untrusted metadata')
    expect(rendered[1]).toEqual({
      type: 'text',
      text: '[]',
    })
    await expect(recent.execute(
      { limit: 21 },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow(/1 to 20/)
    await expect(recent.execute(
      { since_minutes: 10_081 },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow(/1 to 10080/)
    dispose()
  })
})
