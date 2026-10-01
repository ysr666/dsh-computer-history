import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  CollectorSessionId,
  OBSERVATION_RETENTION_MS,
  type ActivityObservation,
  type NativeObservation,
  type ObservationAdapter,
  type PolicyRule,
  type PolicySnapshot,
  type ResourceIdentity,
  type WorkspaceRef,
} from '../../shared/index.js'

const PROTECTED_BUNDLES = new Set([
  'com.1password.1password', 'com.bitwarden.desktop',
  'com.apple.keychainaccess', 'com.dashlane.Dashlane',
  'com.lastpass.LastPass',
])

export function phase1AdapterForBundle(
  bundleId: string,
): ObservationAdapter | undefined {
  if (
    bundleId === 'com.microsoft.VSCode'
    || bundleId === 'com.todesktop.230313mzl4w4u92'
  ) return 'vscode'
  if (
    bundleId === 'com.apple.Terminal'
    || bundleId === 'com.googlecode.iterm2'
  ) return 'terminal'
  if (bundleId === 'com.apple.Preview') return 'preview'
  if (bundleId === 'com.apple.finder') return 'finder'
  return undefined
}


const SECURE_PATH = /(?:^|\/)(?:\.env(?:\.|$)|\.ssh(?:\/|$))|\.(?:pem|key)$|(?:credentials|secrets)/i

function resourceOf(message: NativeObservation): ResourceIdentity | undefined {
  const raw = message.window?.document ?? message.window?.url
  if (!raw) return undefined
  if (/^https?:\/\//i.test(raw)) return { kind: 'url', canonicalUri: raw, ...(message.window?.title ? { displayLabel: message.window.title } : {}) }
  if (/^file:\/\//i.test(raw)) {
    try {
      const url = new URL(raw)
      return { kind: 'file', canonicalUri: url.href, displayLabel: path.basename(decodeURIComponent(url.pathname)) }
    } catch { return undefined }
  }
  if (path.isAbsolute(raw)) return { kind: 'file', canonicalUri: pathToFileURL(raw).href, displayLabel: path.basename(raw) }
  return undefined
}

function globMatches(pattern: string, value: string): boolean {
  let patternIndex = 0
  let valueIndex = 0
  let starIndex = -1
  let starValueIndex = -1
  while (valueIndex < value.length) {
    if (patternIndex < pattern.length && pattern[patternIndex] === value[valueIndex]) {
      patternIndex += 1
      valueIndex += 1
    } else if (patternIndex < pattern.length && pattern[patternIndex] === '*') {
      starIndex = patternIndex++
      starValueIndex = valueIndex
    } else if (starIndex >= 0) {
      patternIndex = starIndex + 1
      valueIndex = ++starValueIndex
    } else return false
  }
  while (patternIndex < pattern.length && pattern[patternIndex] === '*') patternIndex += 1
  return patternIndex === pattern.length
}

function matches(rule: PolicyRule, value: string): boolean {
  if (rule.matcher === 'exact') return value === rule.pattern
  if (rule.matcher === 'prefix') return value.startsWith(rule.pattern)
  return globMatches(rule.pattern, value)
}

export function policyAllows(bundleId: string, resource: ResourceIdentity | undefined, policy: PolicySnapshot): boolean {
  const appRules = policy.rules.filter(rule => rule.dimension === 'app' && matches(rule, bundleId))
  if (appRules.some(rule => rule.action === 'deny' || rule.action === 'protect')) return false
  if (resource && policy.rules.some(rule => rule.dimension === 'resource' && rule.action !== 'allow' && matches(rule, resource.canonicalUri))) return false
  if (policy.mode === 'include-only') return appRules.some(rule => rule.action === 'allow')
  return true
}

export function normalizeObservation(
  message: NativeObservation,
  policy: PolicySnapshot,
  nowMs: number,
  workspace: WorkspaceRef = { source: 'none', confidence: 0 },
): ActivityObservation | undefined {
  if (message.privacy.secure || message.privacy.protected) return undefined
  if (PROTECTED_BUNDLES.has(message.app.bundleId)) return undefined
  const safeAdapter = phase1AdapterForBundle(message.app.bundleId)
  if (!safeAdapter) return undefined
  const resource = resourceOf(message)
  if (resource?.kind === 'url') return undefined
  if (resource?.kind === 'file') {
    try {
      if (SECURE_PATH.test(decodeURIComponent(new URL(resource.canonicalUri).pathname))) return undefined
    } catch { return undefined }
  }
  if (!policyAllows(message.app.bundleId, resource, policy)) return undefined
  return {
    collectorSessionId: CollectorSessionId(message.collectorSession),
    seq: message.seq,
    observedAtMs: message.observedAtMs,
    app: { pid: message.app.pid, bundleId: message.app.bundleId, ...(message.app.name ? { displayName: message.app.name } : {}) },
    surface: {
      kind: safeAdapter === 'vscode'
        ? 'editor'
        : safeAdapter === 'terminal'
          ? 'terminal'
          : safeAdapter === 'preview'
            ? 'document'
            : 'window',
      ...(message.window?.title ? { title: message.window.title } : {}),
    },
    ...(message.element ? { element: message.element } : {}),
    ...(resource ? { resource } : {}),
    workspace,
    activity: message.activity?.idleSeconds === undefined ? {} : { idleSeconds: message.activity.idleSeconds },
    privacy: { secure: false, protected: false },
    source: { provider: 'macos-ax', adapter: safeAdapter },
    policyRevision: policy.revision,
    expiresAtMs: nowMs + OBSERVATION_RETENTION_MS,
  }
}
