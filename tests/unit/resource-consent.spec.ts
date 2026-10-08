import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openHistoryDatabase, PolicyStore } from '../../src/host/store/index.js'
import { describe, expect, it } from 'vitest'
import {
  PolicyRuleId,
  canonicalConsentTarget,
  resourceConsent,
  resourceConsentAllows,
  withResourceConsent,
  type NativeObservation,
  type PolicyRule,
  type PolicySnapshot,
} from '../../src/shared/index.js'
import {
  isProtectedText,
  normalizeObservation,
} from '../../src/host/ingestion/normalize.js'
import { parsePolicyUpdate } from '../../src/host/api/validation.js'

const now = Date.now()
function rule(dimension: 'app' | 'resource', action: 'allow' | 'deny' | 'protect', pattern: string): PolicyRule {
  return {
    id: PolicyRuleId(pattern),
    dimension,
    action,
    matcher: 'exact',
    pattern,
    builtIn: false,
    createdAtMs: now,
    updatedAtMs: now,
  }
}
const appOnly: PolicySnapshot = {
  revision: 1,
  mode: 'include-only',
  rules: [
    rule('app', 'allow', 'companion.browser'),
    rule('app', 'allow', 'com.microsoft.VSCode'),
  ],
  updatedAtMs: now,
}
function setConsent(
  policy: PolicySnapshot,
  kind: 'browser-origin' | 'editor-workspace',
  mode: 'all' | 'selected' | 'none',
  allowed: string[],
): PolicySnapshot {
  return { ...policy, revision: policy.revision + 1,
    rules: withResourceConsent(policy, kind, { mode, allowed }) }
}
function observation(
  kind: 'browser' | 'editor',
  options: { origin?: string; root?: string; native?: boolean; filename?: string } = {},
): NativeObservation {
  const browser = kind === 'browser'
  const provider = options.native ? 'macos-ax' : 'companion'
  return {
    v: 1,
    type: 'observation',
    collectorSession: browser ? 'browser-96' : 'editor-96',
    seq: 1,
    observedAtMs: now,
    app: { pid: 1, bundleId: browser ? 'companion.browser' : 'com.microsoft.VSCode' },
    window: browser
      ? { url: (options.origin ?? 'https://github.com') + '/user/repository' }
      : { document: options.filename ?? (options.root ?? '/Users/test/alpha') + '/main.ts' },
    ...(browser ? {} : { workspace: { root: options.root ?? '/Users/test/alpha', title: 'alpha' } }),
    privacy: { secure: false, protected: false },
    source: { provider, adapter: browser ? 'browser' : 'vscode' },
  }
}
function permits(message: NativeObservation, policy: PolicySnapshot): boolean {
  const workspace = message.workspace?.root
    ? { source: message.source.provider === 'companion' ? 'companion' as const : 'filesystem' as const,
        confidence: 1, root: message.workspace.root }
    : { source: 'none' as const, confidence: 0 }
  return normalizeObservation(message, policy, now + 1000, workspace) !== undefined
}

describe('Issue #96 — explicit per-origin and per-workspace consent', () => {
  it('preserves old app-only policy on upgrade; rules for one type do not change another', () => {
    expect(resourceConsent(appOnly, 'browser-origin')).toEqual({ mode: 'all', allowed: [] })
    expect(permits(observation('browser', { origin: 'https://other.test' }), appOnly)).toBe(true)
    expect(permits(observation('editor', { root: '/Users/test/beta' }), appOnly)).toBe(true)
    const policy = setConsent(appOnly, 'browser-origin', 'selected', ['https://github.com'])
    expect(permits(observation('editor', { root: '/Users/test/beta' }), policy)).toBe(true)
    expect(permits(observation('browser', { origin: 'https://other.test' }), policy)).toBe(false)
  })

  it('records exactly approved HTTPS origin, refusing different origins, forged subdomains and no-resource observations', () => {
    const policy = setConsent(appOnly, 'browser-origin', 'selected', ['https://github.com'])
    expect(permits(observation('browser'), policy)).toBe(true)
    expect(permits(observation('browser', { origin: 'https://gist.github.com' }), policy)).toBe(false)
    expect(permits(observation('browser', { origin: 'https://github.com.evil.test' }), policy)).toBe(false)
    expect(permits(observation('browser', { origin: 'https://other.test' }), policy)).toBe(false)
    expect(resourceConsentAllows(policy, 'browser-origin', undefined)).toBe(false)
    expect(resourceConsentAllows(policy, 'browser-origin', 'https://github.com.evil.test')).toBe(false)
  })

  it('fail-closes empty selected lists and None; restores legacy mode only by explicit All choice', () => {
    let policy = setConsent(appOnly, 'browser-origin', 'selected', [])
    expect(permits(observation('browser'), policy)).toBe(false)
    policy = setConsent(policy, 'browser-origin', 'none', [])
    expect(permits(observation('browser'), policy)).toBe(false)
    policy = setConsent(policy, 'browser-origin', 'all', [])
    expect(permits(observation('browser'), policy)).toBe(true)
  })

  it('requires a real vouched editor workspace; native AX never bypasses the selected list', () => {
    const policy = setConsent(appOnly, 'editor-workspace', 'selected', ['/Users/test/alpha'])
    expect(permits(observation('editor', { root: '/Users/test/alpha' }), policy)).toBe(true)
    expect(permits(observation('editor', { root: '/Users/test/alpha-other' }), policy)).toBe(false)
    expect(permits(observation('editor', { root: '/Users/test/beta' }), policy)).toBe(false)
    expect(permits(observation('editor', { root: '/Users/test/alpha', native: true }), policy)).toBe(false)
    expect(permits(observation('browser'), policy)).toBe(true)
  })

  it('keeps an explicit resource deny and built-in secret protection above consent allows', () => {
    const allowed = setConsent(appOnly, 'browser-origin', 'selected', ['https://github.com'])
    const denied = { ...allowed, rules: [...allowed.rules,
      rule('resource', 'deny', 'https://github.com/secret')] }
    const blocked = observation('browser')
    expect(permits({ ...blocked, window: { url: 'https://github.com/secret' } }, denied)).toBe(false)
    expect(permits(blocked, denied)).toBe(true)

    const editorPolicy = setConsent(appOnly, 'editor-workspace', 'selected', ['/Users/test/alpha'])
    const secret = observation('editor', { filename: '/Users/test/alpha/.env' })
    expect(permits(secret, editorPolicy)).toBe(false)
    expect(isProtectedText('/Users/test/alpha/.env', editorPolicy)).toBe(true)
  })

  it('does not silently activate legacy resource allow rules, and roundtrips new typed rules via policy API', () => {
    const legacy = { ...appOnly, rules: [...appOnly.rules,
      rule('resource', 'allow', 'https://example.com/')] }
    expect(permits(observation('browser', { origin: 'https://elsewhere.test' }), legacy)).toBe(true)
    const policy = setConsent(legacy, 'browser-origin', 'selected', ['https://github.com'])
    expect(permits(observation('browser', { origin: 'https://elsewhere.test' }), policy)).toBe(false)
    const parsed = parsePolicyUpdate({ mode: 'include-only', rules: policy.rules })
    expect(resourceConsent({ ...policy, rules: parsed.rules }, 'browser-origin')).toEqual({
      mode: 'selected', allowed: ['https://github.com'],
    })
    expect(() => parsePolicyUpdate({ mode: 'include-only', rules: [
      rule('resource', 'allow', '@dch-consent/v1/browser-origin/allow/not-a-url'),
    ] })).toThrow(/canonical exact patterns/)
  })

  it('normalises Windows roots and excludes traversal, URLs with credential/query/path and relative roots', () => {
    expect(canonicalConsentTarget('editor-workspace', 'C:\\Projects\\APP')).toBe('c:/projects/app')
    expect(canonicalConsentTarget('editor-workspace', 'C:\\Projects\\App\\..\\APP')).toBe('c:/projects/app')
    expect(canonicalConsentTarget('editor-workspace', './Projects')).toBeUndefined()
    expect(canonicalConsentTarget('editor-workspace', '/../oops')).toBeUndefined()
    expect(canonicalConsentTarget('browser-origin', 'https://github.com?token=secret')).toBeUndefined()
    expect(canonicalConsentTarget('browser-origin', 'https://user:pw@github.com')).toBeUndefined()
    expect(canonicalConsentTarget('browser-origin', 'https://github.com/repo')).toBeUndefined()
  })
})

describe('resource consent survives local policy-store reload', () => {
  it('persists a selected browser origin and an empty editor allowlist independently', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dch-consent-96-'))
    const folder = path.join(root, 'db')
    let db = openHistoryDatabase({ dataDirectory: folder })
    try {
      const policies = new PolicyStore(db.db)
      let policy = policies.ensureInitial(Date.now())
      policy = policies.replace(
        'include-only',
        [...policy.rules, ...appOnly.rules],
        Date.now(),
      )
      const siteRules = withResourceConsent(policy, 'browser-origin', {
        mode: 'selected', allowed: ['https://github.com'],
      })
      policy = policies.replace('include-only', siteRules, Date.now())
      policy = policies.replace('include-only',
        withResourceConsent(policy, 'editor-workspace', {
          mode: 'selected', allowed: [],
        }), Date.now())
      expect(resourceConsent(policy, 'editor-workspace').mode).toBe('selected')
      const previousRevision = policy.revision
      db.close()
      db = openHistoryDatabase({ dataDirectory: folder })
      const reloaded = new PolicyStore(db.db).get()
      expect(reloaded.revision).toBe(previousRevision)
      expect(resourceConsent(reloaded, 'browser-origin')).toEqual({
        mode: 'selected', allowed: ['https://github.com'],
      })
      expect(resourceConsent(reloaded, 'editor-workspace')).toEqual({
        mode: 'selected', allowed: [],
      })
      expect(permits(observation('browser'), reloaded)).toBe(true)
      expect(permits(observation('browser', { origin: 'https://other.test' }), reloaded)).toBe(false)
      expect(permits(observation('editor'), reloaded)).toBe(false)
      expect(isProtectedText('/Users/test/alpha/.env', reloaded)).toBe(true)
    } finally {
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
