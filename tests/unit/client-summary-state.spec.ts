import { describe, expect, it } from 'vitest'
import { summaryDisplayStatus } from '../../src/client/panel.js'
import type { SemanticSummaryState } from '../../src/shared/index.js'

const deterministic: SemanticSummaryState = {
  active: 'deterministic',
  localProviderConfigured: false,
  scopes: [],
}

describe('summary presentation state', () => {
  it('does not call deterministic summaries a local model', () => {
    expect(summaryDisplayStatus(undefined)).toBe('loading')
    expect(summaryDisplayStatus(null)).toBe('unavailable')
    expect(summaryDisplayStatus(deterministic)).toBe('deterministic')
    expect(summaryDisplayStatus({
      ...deterministic,
      scopes: [{
        scopeKey: 'workspace:w1', providerKind: 'local', createdAtMs: 1,
      }],
    })).toBe('local')
    expect(summaryDisplayStatus({
      ...deterministic,
      scopes: [
        { scopeKey: 'workspace:w1', providerKind: 'local', createdAtMs: 1 },
        { scopeKey: 'app:com.microsoft.VSCode', providerKind: 'remote', createdAtMs: 2 },
      ],
    })).toBe('remote')
  })
})
