import { describe, expect, it } from 'vitest'
import {
  PolicyRuleId,
  type NativeObservation,
  type PolicySnapshot,
} from '../../src/shared/index.js'
import {
  normalizeObservation,
  type RefusalReport,
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

  it('rejects negative observation identity fields', () => {
    const base = {
      v: 1,
      type: 'observation',
      collectorSession: 's1',
      seq: 1,
      observedAtMs: 1,
      app: {
        pid: 1,
        bundleId: 'com.microsoft.VSCode',
      },
      privacy: {
        secure: false,
        protected: false,
      },
      source: { adapter: 'vscode' },
    }
    expect(() => parseCollectorLine(
      JSON.stringify({ ...base, seq: -1 }),
    )).toThrow(/non-negative/)
    expect(() => parseCollectorLine(
      JSON.stringify({
        ...base,
        app: { ...base.app, pid: -1 },
      }),
    )).toThrow(/non-negative/)
    expect(() => parseCollectorLine(
      JSON.stringify({ ...base, observedAtMs: -1 }),
    )).toThrow(/non-negative/)
  })

  it('accepts configured acknowledgements with bounded revisions', () => {
    expect(parseCollectorLine(JSON.stringify({
      v: 1,
      type: 'configured',
      revision: 7,
    }))).toEqual({
      v: 1,
      type: 'configured',
      revision: 7,
    })
    expect(() => parseCollectorLine(JSON.stringify({
      v: 1,
      type: 'configured',
      revision: -1,
    }))).toThrow(/non-negative/)
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
  it('is include-only and rejects unlisted or legacy exclude policies', () => {
    expect(policyAllows('com.microsoft.VSCode', undefined, policy)).toBe(true)
    expect(policyAllows('com.google.Chrome', undefined, policy)).toBe(false)
    expect(policyAllows(
      'com.microsoft.VSCode',
      undefined,
      { ...policy, mode: 'exclude' },
    )).toBe(false)
  })

  it('says why the lock screen is not recorded', () => {
    // The behaviour alone was not checkable: three attempts passed for reasons
    // other than the one they named. The reason is what makes it checkable.
    const refusal: RefusalReport = {}
    const result = normalizeObservation(
      native({
        app: { pid: 0, bundleId: 'com.apple.loginwindow', name: 'loginwindow' },
      }),
      policy,
      2_000,
      undefined,
      undefined,
      undefined,
      refusal,
    )
    expect(result).toBeUndefined()
    expect(refusal.reason).toBe('not-an-adapter')
  })

  it('rejects secure and protected observations before persistence', () => {
    expect(normalizeObservation(native({
      privacy: { secure: true, protected: false },
    }), policy, 2_000)).toBeUndefined()
    expect(normalizeObservation(native({
      privacy: { secure: false, protected: true },
    }), policy, 2_000)).toBeUndefined()
  })

  it('counts a protected application under its own reason, not as a secure field', () => {
    // The collector marks a protected application with `privacy.protected` and the reason the
    // protocol documents. Calling that a secure field would make the refusal breakdown
    // incomparable with the names the cross-platform fixture declares.
    const protectedRefusal: RefusalReport = {}
    expect(normalizeObservation(native({
      privacy: { secure: false, protected: true, reason: 'protected-app' },
    }), policy, 2_000, undefined, undefined, undefined, protectedRefusal))
      .toBeUndefined()
    expect(protectedRefusal.reason).toBe('protected-app')

    // An unreadable secure surface keeps the secure-field name.
    const secureRefusal: RefusalReport = {}
    expect(normalizeObservation(native({
      privacy: { secure: true, protected: false, reason: 'secure-field' },
    }), policy, 2_000, undefined, undefined, undefined, secureRefusal))
      .toBeUndefined()
    expect(secureRefusal.reason).toBe('secure-field')

    // A protected observation without the documented reason stays in the secure-field bucket.
    const unnamedRefusal: RefusalReport = {}
    expect(normalizeObservation(native({
      privacy: { secure: false, protected: true },
    }), policy, 2_000, undefined, undefined, undefined, unnamedRefusal))
      .toBeUndefined()
    expect(unnamedRefusal.reason).toBe('secure-field')
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

  it('rejects implausibly future-dated observations', () => {
    expect(normalizeObservation(native({
      observedAtMs: 10 * 60 * 1000,
    }), policy, 1_000)).toBeUndefined()
  })

  it('treats Terminal cwd as a directory resource and protects sensitive directories', () => {
    const terminalPolicy: PolicySnapshot = {
      ...policy,
      rules: [...policy.rules, {
        ...policy.rules[0]!,
        id: PolicyRuleId('terminal'),
        pattern: 'com.apple.Terminal',
      }],
    }
    const terminal = normalizeObservation(native({
      app: { pid: 5, bundleId: 'com.apple.Terminal' },
      window: {
        title: 'secret command --token value',
        document: '/repo',
      },
      source: { adapter: 'terminal' },
    }), terminalPolicy, 2_000)
    expect(terminal).toMatchObject({
      surface: { kind: 'terminal' },
      resource: {
        kind: 'directory',
        canonicalUri: 'file:///repo',
      },
    })
    expect(terminal?.surface.title).toBeUndefined()

    expect(normalizeObservation(native({
      app: { pid: 6, bundleId: 'com.apple.Terminal' },
      window: {
        title: 'shell',
        document: '/Users/demo/.ssh',
      },
      source: { adapter: 'terminal' },
    }), terminalPolicy, 2_000)).toBeUndefined()
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

describe('host-side metadata defence in depth', () => {
  const protectedRule = {
    ...policy.rules[0]!,
    id: PolicyRuleId('protect-notes'),
    dimension: 'resource' as const,
    action: 'protect' as const,
    matcher: 'glob' as const,
    pattern: '*secret-notes*',
  }
  const withRule: PolicySnapshot = {
    ...policy,
    rules: [policy.rules[0]!, protectedRule],
  }

  it('drops a protected identifier even when the resource itself is safe', () => {
    expect(normalizeObservation(native({
      element: { role: 'AXTextField', identifier: '/repo/.env' },
    }), policy, 2_000)).toBeUndefined()
  })

  it('drops a protected document regardless of the window title', () => {
    expect(normalizeObservation(native({
      window: { title: 'harmless.ts', document: '/repo/.ssh/id_rsa' },
    }), policy, 2_000)).toBeUndefined()
  })

  it('drops a title matching an explicit user rule', () => {
    expect(normalizeObservation(native({
      window: { title: 'secret-notes.txt', document: '/repo/plain.ts' },
    }), withRule, 2_000)).toBeUndefined()
  })

  it('keeps an ordinary title that only mentions a path-like word', () => {
    expect(normalizeObservation(native({
      window: { title: '.env notes.md', document: '/repo/plain.ts' },
    }), policy, 2_000)).toMatchObject({
      surface: { title: '.env notes.md' },
    })
  })

  it('fails closed on percent-encoded protected paths', () => {
    expect(normalizeObservation(native({
      window: { title: 'x', document: '/repo/%2eenv' },
    }), policy, 2_000)).toBeUndefined()
  })

  it('fails closed when an escape sequence cannot be decoded', () => {
    expect(normalizeObservation(native({
      element: { role: 'AXTextField', identifier: '%zz' },
    }), policy, 2_000)).toBeUndefined()
  })

  it('still accepts a normal identifier and document', () => {
    expect(normalizeObservation(native({
      element: { role: 'AXTextField', identifier: 'editor-input' },
    }), policy, 2_000)).toMatchObject({
      element: { identifier: 'editor-input' },
    })
  })
})

describe('bare-filename window titles', () => {
  it('drops a title that is itself a protected location', () => {
    expect(normalizeObservation(native({
      window: { title: '.env' },
    }), policy, 2_000)).toBeUndefined()
    expect(normalizeObservation(native({
      window: { title: 'aws-credentials.json' },
    }), policy, 2_000)).toBeUndefined()
    expect(normalizeObservation(native({
      window: { title: '/Users/demo/.ssh/id_rsa' },
    }), policy, 2_000)).toBeUndefined()
  })

  it('keeps descriptive titles that merely mention a sensitive word', () => {
    expect(normalizeObservation(native({
      window: {
        title: '.env notes.md',
        document: '/repo/plain.ts',
      },
    }), policy, 2_000)).toMatchObject({
      surface: { title: '.env notes.md' },
    })
    expect(normalizeObservation(native({
      window: {
        title: 'Managing secrets safely',
        document: '/repo/plain.ts',
      },
    }), policy, 2_000)).toMatchObject({
      surface: { title: 'Managing secrets safely' },
    })
  })
})
