import { describe, expect, it } from 'vitest'
import { name } from '../src/index.js'

describe('repository scaffold', () => {
  it('exports the plugin identity', () => {
    expect(name).toBe('dsh-computer-history')
  })
})
