import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import {
  registerComputerHistoryTools,
} from '../../src/agent/index.js'

describe('agent-scoped Computer History surfaces', () => {
  it('keeps canonical tool values structured while rendering an untrusted-data warning', async () => {
    const definitions = new Map<string, ToolDefinition>()
    const ctx = {
      tools: {
        register(definition: ToolDefinition) {
          definitions.set(definition.name, definition)
          return () => { definitions.delete(definition.name) }
        },
      },
      computerHistory: {
        recent: async () => [],
        search: async () => [],
        getEpisode: async () => undefined,
      },
    } as unknown as Context

    const dispose = registerComputerHistoryTools(ctx)
    const recent = definitions.get('computer_history_recent')!
    const value = await recent.execute(
      {},
      { signal: new AbortController().signal } as never,
    )
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
    dispose()
  })
})
