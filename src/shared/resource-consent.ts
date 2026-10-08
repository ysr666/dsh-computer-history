import { PolicyRuleId } from './ids.js'
import type { PolicyRule, PolicySnapshot } from './policy.js'

/**
 * Issue #96: opt-in resource allow lists, persisted inside the existing
 * versioned policy_rules table. A private namespace and exact matcher make
 * these rules distinguishable from legacy resource deny/protect patterns.
 * Historical app-only policies keep their existing behaviour (mode='all').
 */
export type ConsentKind = 'browser-origin' | 'editor-workspace'
export type ConsentMode = 'all' | 'selected' | 'none'
export interface ResourceConsent {
  readonly mode: ConsentMode
  readonly allowed: readonly string[]
}

const PREFIX = '@dch-consent/v1/'
function modePattern(kind: ConsentKind, mode: 'selected' | 'none'): string {
  return `${PREFIX}${kind}/mode/${mode}`
}
function allowPattern(kind: ConsentKind, value: string): string {
  return `${PREFIX}${kind}/allow/${value}`
}
function isConsentRule(rule: PolicyRule, kind: ConsentKind): boolean {
  return rule.dimension === 'resource'
    && (rule.pattern === modePattern(kind, 'selected')
      || rule.pattern === modePattern(kind, 'none')
      || rule.pattern.startsWith(allowPattern(kind, '')))
}

// Pure string normalisation: this shared module is also used in the browser
// Settings UI, which cannot import Node's path module.
export function canonicalConsentTarget(kind: ConsentKind, value: string): string | undefined {
  const raw = value.trim()
  if (!raw || raw.length > 1024 || raw.includes('\0')) return undefined
  if (kind === 'browser-origin') {
    try {
      const url = new URL(raw)
      if (
        (url.protocol !== 'https:' && url.protocol !== 'http:')
        || url.username || url.password || url.search || url.hash
        || url.pathname !== '/'
        || url.origin === 'null'
      ) return undefined
      return url.origin
    } catch { return undefined }
  }

  const windowsDrive = /^[A-Za-z]:[\\/]/.test(raw)
  const unc = /^\\\\[^\\/]+[\\/][^\\/]+/.test(raw)
  if (!windowsDrive && !unc && !raw.startsWith('/')) return undefined
  if (!windowsDrive && !unc && raw.includes('\\')) return undefined
  const text = windowsDrive || unc ? raw.replaceAll('\\', '/') : raw
  const prefix = windowsDrive
    ? text.slice(0, 2).toLowerCase() + '/'
    : unc
      ? '//'
      : '/'
  const tail = windowsDrive ? text.slice(2) : text
  const parts: string[] = []
  for (const segment of tail.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return undefined
      parts.pop()
    } else {
      parts.push(windowsDrive || unc ? segment.toLowerCase() : segment)
    }
  }
  return prefix + parts.join('/')
}

export function resourceConsent(policy: PolicySnapshot, kind: ConsentKind): ResourceConsent {
  const hasNone = policy.rules.some(item =>
    item.dimension === 'resource' && item.action === 'allow'
    && item.pattern === modePattern(kind, 'none'))
  const hasSelected = policy.rules.some(item =>
    item.dimension === 'resource' && item.action === 'allow'
    && item.pattern === modePattern(kind, 'selected'))
  // In a malformed/conflicting policy the restrictive mode always wins.
  const mode: ConsentMode = hasNone ? 'none' : hasSelected ? 'selected' : 'all'
  const allowed = policy.rules
    .filter(item => item.action === 'allow'
      && item.dimension === 'resource'
      && item.pattern.startsWith(allowPattern(kind, '')))
    .map(item => item.pattern.slice(allowPattern(kind, '').length))
    .filter(item => canonicalConsentTarget(kind, item) === item)
  return { mode, allowed: [...new Set(allowed)] }
}

export function resourceConsentAllows(
  policy: PolicySnapshot,
  kind: ConsentKind,
  target: string | undefined,
): boolean {
  const consent = resourceConsent(policy, kind)
  if (consent.mode === 'all') return true
  if (consent.mode === 'none' || !target) return false
  const canonical = canonicalConsentTarget(kind, target)
  return canonical !== undefined && consent.allowed.includes(canonical)
}

export function withResourceConsent(
  policy: PolicySnapshot,
  kind: ConsentKind,
  input: ResourceConsent,
  nowMs: number = Date.now(),
): PolicySnapshot['rules'] {
  if (!['all', 'selected', 'none'].includes(input.mode)) throw new Error('invalid consent mode')
  if (input.allowed.length > 64) throw new Error('too many consent targets')
  const canonical = input.allowed.map(value => canonicalConsentTarget(kind, value))
  if (canonical.some(value => value === undefined)) throw new Error('invalid consent target')
  const rules = policy.rules.filter(item => !isConsentRule(item, kind))
  const makeRule = (pattern: string, action: 'allow' | 'deny'): PolicyRule => ({
    id: PolicyRuleId(pattern),
    dimension: 'resource',
    action,
    matcher: 'exact',
    pattern,
    builtIn: false,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  })
  if (input.mode !== 'all') {
    rules.push(makeRule(modePattern(kind, input.mode), 'allow'))
    if (input.mode === 'selected') {
      for (const value of new Set(canonical as string[])) {
        rules.push(makeRule(allowPattern(kind, value), 'allow'))
      }
    }
  }
  return rules
}

/** Fail-closed for forged/malformed consent markers arriving through the API. */
export function validateConsentRule(rule: PolicyRule): boolean {
  if (rule.dimension !== 'resource' || !rule.pattern.startsWith(PREFIX)) return true
  if (rule.builtIn || rule.matcher !== 'exact') return false
  for (const kind of ['browser-origin', 'editor-workspace'] as const) {
    if (rule.pattern === modePattern(kind, 'selected')
      || rule.pattern === modePattern(kind, 'none')) {
      return rule.action === 'allow'
    }
    const prefix = allowPattern(kind, '')
    if (rule.pattern.startsWith(prefix)) {
      return rule.action === 'allow'
        && canonicalConsentTarget(kind, rule.pattern.slice(prefix.length))
          === rule.pattern.slice(prefix.length)
    }
  }
  return false
}
