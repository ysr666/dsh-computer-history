import { describe, expect, it } from 'vitest'
import {
  PolicyRuleId,
  type NativeObservation,
  type PolicySnapshot,
} from '../../src/shared/index.js'
import {
  normalizeObservation,
  policyAllows,
} from '../../src/host/ingestion/index.js'
import { parseCollectorLine } from '../../src/host/collector/index.js'

const policy: PolicySnapshot = {
  revision: 1,
  mode: 'include-only',
  rules: [{
    id: PolicyRuleId('code'),
    dimension: 'app',
    action: 'allow',
    matcher: 'exact',
    pattern: 'com.microsoft.VSCode',
    builtIn: false,
    createdAtMs: 1,
    updatedAtMs: 1,
  }],
  updatedAtMs: 1,
}

function native(overrides: Partial<NativeObservation> = {}): NativeObservation {
  return {
    v: 1,
    type: 'observation',
    collectorSession: 's1',
    seq: 1,
    observedAtMs: 1_000,
    app: {
      pid: 1,
      bundleId: 'com.microsoft.VSCode',
      name: 'Code',
    },
    window: {
      title: 'provider.ts',
      document: '/repo/src/provider.ts',
    },
    privacy: {
      secure: false,
      protected: false,
    },
    source: {
      adapter: 'vscode',
    },
    ...overrides,
  }
}

describe('collector protocol', () => {
  it('rejects malformed and incompatible lines', () => {
    expect(() => parseCollectorLine('{')).toThrow(/invalid JSON/)
    expect(() => parseCollectorLine('{"v":2,"type":"state"}'))
      .toThrow(/version mismatch/)
  })

  it('accepts the versioned hello envelope', () => {
    expect(parseCollectorLine(JSON.stringify({
      v: 1,
      type: 'hello',
      collectorSession: 's1',
      collectorVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      capabilities: [],
    }))).toMatchObject({
      type: 'hello',
      collectorSession: 's1',
    })
  })
})

describe('live privacy normalization', () => {
  it('is include-only and rejects unlisted applications', () => {
    expect(policyAllows('com.microsoft.VSCode', undefined, policy)).toBe(true)
    expect(policyAllows('com.google.Chrome', undefined, policy)).toBe(false)
  })

  it('rejects secure and protected observations before persistence', () => {
    expect(normalizeObservation(native({
      privacy: { secure: true, protected: false },
    }), policy, 2_000)).toBeUndefined()
    expect(normalizeObservation(native({
      privacy: { secure: false, protected: true },
    }), policy, 2_000)).toBeUndefined()
  })

  it('rejects protected file patterns before persistence', () => {
    expect(normalizeObservation(native({
      window: {
        title: '.env',
        document: '/repo/.env',
      },
    }), policy, 2_000)).toBeUndefined()
  })

  it('fails closed for browsers and protected applications even if allowed', () => {
    const permissive: PolicySnapshot = {
      ...policy,
      rules: [
        ...policy.rules,
        {
          ...policy.rules[0]!,
          id: PolicyRuleId('chrome'),
          pattern: 'com.google.Chrome',
        },
        {
          ...policy.rules[0]!,
          id: PolicyRuleId('one-password'),
          pattern: 'com.1password.1password',
        },
      ],
    }
    expect(normalizeObservation(native({
      app: { pid: 2, bundleId: 'com.google.Chrome' },
    }), permissive, 2_000)).toBeUndefined()
    expect(normalizeObservation(native({
      app: { pid: 3, bundleId: 'com.1password.1password' },
    }), permissive, 2_000)).toBeUndefined()
  })

  it('fails closed for unsupported app families', () => {
    const permissive: PolicySnapshot = {
      ...policy,
      rules: [...policy.rules, {
        ...policy.rules[0]!,
        id: PolicyRuleId('firefox'),
        pattern: 'org.mozilla.firefox',
      }],
    }
    expect(normalizeObservation(native({
      app: { pid: 4, bundleId: 'org.mozilla.firefox' },
      source: { adapter: 'generic' },
    }), permissive, 2_000)).toBeUndefined()
  })

  it('normalizes safe metadata without reading content', () => {
    expect(normalizeObservation(native(), policy, 2_000)).toMatchObject({
      app: { bundleId: 'com.microsoft.VSCode' },
      surface: { kind: 'editor' },
      resource: {
        kind: 'file',
        canonicalUri: 'file:///repo/src/provider.ts',
      },
      policyRevision: 1,
    })
  })
})
