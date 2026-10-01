import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  CollectorSessionId,
  OBSERVATION_RETENTION_MS,
  policyRuleMatches,
  type ActivityObservation,
  type NativeObservation,
  type ObservationAdapter,
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

function resourceOf(
  message: NativeObservation,
  adapter: ObservationAdapter,
): ResourceIdentity | undefined {
  const raw = message.window?.document ?? message.window?.url
  if (!raw) return undefined
  if (/^https?:\/\//i.test(raw)) return { kind: 'url', canonicalUri: raw, ...(message.window?.title ? { displayLabel: message.window.title } : {}) }
  if (/^file:\/\//i.test(raw)) {
    try {
      const url = new URL(raw)
      return {
        kind: adapter === 'terminal' ? 'directory' : 'file',
        canonicalUri: url.href,
        displayLabel: path.basename(decodeURIComponent(url.pathname)),
      }
    } catch { return undefined }
  }
  if (path.isAbsolute(raw)) {
    return {
      kind: adapter === 'terminal' ? 'directory' : 'file',
      canonicalUri: pathToFileURL(raw).href,
      displayLabel: path.basename(raw),
    }
  }
  return undefined
}

export function policyAllows(bundleId: string, resource: ResourceIdentity | undefined, policy: PolicySnapshot): boolean {
  if (policy.mode !== 'include-only') return false

  const appRules = policy.rules.filter(rule =>
    rule.dimension === 'app'
    && policyRuleMatches(rule, bundleId),
  )
  if (appRules.some(rule =>
    rule.action === 'deny' || rule.action === 'protect'
  )) return false
  if (resource && policy.rules.some(rule =>
    rule.dimension === 'resource'
    && rule.action !== 'allow'
    && policyRuleMatches(rule, resource.canonicalUri)
  )) return false
  return appRules.some(rule => rule.action === 'allow')
}

export function normalizeObservation(
  message: NativeObservation,
  policy: PolicySnapshot,
  nowMs: number,
  workspace: WorkspaceRef = { source: 'none', confidence: 0 },
  resourceOverride?: ResourceIdentity,
): ActivityObservation | undefined {
  if (message.privacy.secure || message.privacy.protected) return undefined
  if (PROTECTED_BUNDLES.has(message.app.bundleId)) return undefined
  const safeAdapter = phase1AdapterForBundle(message.app.bundleId)
  if (!safeAdapter) return undefined
  const resource = resourceOverride
    ?? resourceOf(message, safeAdapter)
  if (resource?.kind === 'url') return undefined
  if (
    resource?.kind === 'file'
    || resource?.kind === 'directory'
  ) {
    try {
      if (SECURE_PATH.test(decodeURIComponent(new URL(resource.canonicalUri).pathname))) return undefined
    } catch { return undefined }
  }
  if (!policyAllows(message.app.bundleId, resource, policy)) return undefined

  if (message.observedAtMs > nowMs) {
    return undefined
  }

  const expiresAtMs = message.observedAtMs + OBSERVATION_RETENTION_MS
  if (
    !Number.isSafeInteger(expiresAtMs)
    || expiresAtMs <= nowMs
  ) return undefined

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
      ...(
        safeAdapter !== 'terminal'
        && message.window?.title
          ? { title: message.window.title }
          : {}
      ),
    },
    ...(message.element
      ? {
          element: {
            ...(message.element.role
              ? { role: message.element.role }
              : {}),
            ...(message.element.subrole
              ? { subrole: message.element.subrole }
              : {}),
            ...(message.element.identifier
              ? { identifier: message.element.identifier }
              : {}),
          },
        }
      : {}),
    ...(resource ? { resource } : {}),
    workspace,
    activity: message.activity?.idleSeconds === undefined ? {} : { idleSeconds: message.activity.idleSeconds },
    privacy: { secure: false, protected: false },
    source: { provider: 'macos-ax', adapter: safeAdapter },
    policyRevision: policy.revision,
    expiresAtMs,
  }
}
