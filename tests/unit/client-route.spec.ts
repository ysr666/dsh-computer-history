import { describe, expect, it } from 'vitest'
import { historyApiPath } from '../../src/client/api-route.js'

describe('client history API routing', () => {
  it('stays document-relative under a non-root public mount', () => {
    const route = historyApiPath('/state')
    expect(route).toBe('api/computer-history/state')
    expect(new URL(
      route,
      'https://example.test/public/index.html',
    ).pathname).toBe('/public/api/computer-history/state')
  })
})
