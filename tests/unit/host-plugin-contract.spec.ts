import { describe, expect, it } from 'vitest'
import { inject } from '../../src/host/plugin.js'

describe('Host plugin service contract', () => {
  it('keeps prior-session projection optional while declaring core Agent dependencies', () => {
    expect(inject).not.toContain('sessionQuery')
    expect(inject).toContain('systemPrompt')
    expect(inject).toContain('agents')
    expect(inject).toContain('tools')
  })
})
