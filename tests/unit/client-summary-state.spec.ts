import { describe, expect, it } from 'vitest'
import {
  createLatestRequestGate,
  summaryDisplayStatus,
} from '../../src/client/panel.js'
import type { SemanticSummaryState } from '../../src/shared/index.js'

const deterministic: SemanticSummaryState = {
  active: 'deterministic',
  providers: {
    local: { available: false, reason: 'not-wired' },
    remote: { available: false, reason: 'not-wired' },
  },
  scopes: [],
}

describe('latest request gate', () => {
  it('lets only the newest async request publish', () => {
    const gate = createLatestRequestGate()
    const first = gate.begin()
    expect(gate.isCurrent(first)).toBe(true)

    const second = gate.begin()
    expect(gate.isCurrent(first)).toBe(false)
    expect(gate.isCurrent(second)).toBe(true)

    gate.invalidate()
    expect(gate.isCurrent(second)).toBe(false)
  })
})

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
    })).toBe('provider-unavailable')
    expect(summaryDisplayStatus({
      ...deterministic,
      providers: {
        local: { available: true, model: 'local-model' },
        remote: { available: false, reason: 'not-wired' },
      },
      scopes: [{
        scopeKey: 'workspace:w1', providerKind: 'local', createdAtMs: 1,
      }],
    })).toBe('local')
    expect(summaryDisplayStatus({
      ...deterministic,
      providers: {
        local: { available: true, model: 'local-model' },
        remote: { available: true, model: 'remote-model' },
      },
      scopes: [
        { scopeKey: 'workspace:w1', providerKind: 'local', createdAtMs: 1 },
        { scopeKey: 'app:com.microsoft.VSCode', providerKind: 'remote', createdAtMs: 2 },
      ],
    })).toBe('remote')
  })
})
