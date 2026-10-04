import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  CollectorSessionId,
  OBSERVATION_RETENTION_MS,
  PHASE1_ADAPTERS,
  phase1AdapterDefinition,
  policyRuleMatches,
  type ActivityObservation,
  type NativeObservation,
  type ObservationAdapter,
  type Phase1AdapterDefinition,
  type PolicySnapshot,
  type ResourceIdentity,
  type WorkspaceRef,
} from '../../shared/index.js'

export const PROTECTED_BUNDLES = new Set([
  'com.1password.1password', 'com.bitwarden.desktop',
  'com.apple.keychainaccess', 'com.dashlane.Dashlane',
  'com.lastpass.LastPass',
])

/**
 * Resolve a bundle id through the shared adapter table. An unknown bundle is
 * not an adapter: the caller drops the observation rather than guessing a
 * surface, so a helper that invents a bundle id cannot widen the surface.
 */
export function phase1AdapterForBundle(
  bundleId: string,
): ObservationAdapter | undefined {
  return PHASE1_ADAPTERS.find(adapter =>
    adapter.bundleIds.includes(bundleId),
  )?.id
}


export const SECURE_PATH = /(?:^|\/)(?:\.env(?:\.|$)|\.ssh(?:\/|$))|\.(?:pem|key)$|(?:credentials|secrets)/i

/**
 * Defence in depth for the Host's own store. The native helper already
 * screens every metadata field it emits, but a malformed or hostile
 * helper could skip that and send a protected title or identifier
 * directly.
 */
export function isProtectedText(
  value: string,
  policy: PolicySnapshot,
): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    // A malformed escape sequence is not evidence of safety.
    return true
  }

  if (SECURE_PATH.test(decoded)) return true

  return policy.rules.some(rule =>
    rule.dimension === 'resource'
    && rule.action !== 'allow'
    && (
        policyRuleMatches(rule, value)
        || policyRuleMatches(rule, decoded)
      )
  )
}

/**
 * A window title can itself be a bare sensitive location: editors often
 * title a window with just the file name, so a `.env` or `id_rsa` can
 * appear as the title even when no document attribute is exposed.
 * Titles that contain whitespace are treated as descriptive text and
 * only screened against explicit user rules, because the blunt path
 * heuristic would otherwise drop legitimate titles.
 */
export function isProtectedTitle(
  title: string,
  policy: PolicySnapshot,
): boolean {
  if (/\s/.test(title)) {
    return policy.rules.some(rule =>
      rule.dimension === 'resource'
      && rule.action !== 'allow'
      && policyRuleMatches(rule, title)
    )
  }
  return isProtectedText(title, policy)
}

function isProtectedMetadata(
  message: NativeObservation,
  policy: PolicySnapshot,
): boolean {
  for (
    const value of [
      message.window?.document,
      message.window?.url,
      message.element?.identifier,
    ]
  ) {
    if (value && isProtectedText(value, policy)) return true
  }

  return Boolean(
    message.window?.title
    && isProtectedTitle(message.window.title, policy),
  )
}

function resourceOf(
  message: NativeObservation,
  adapter: Phase1AdapterDefinition,
): ResourceIdentity | undefined {
  const raw = message.window?.document ?? message.window?.url
  if (!raw) return undefined
  if (/^https?:\/\//i.test(raw)) {
    // Query strings and fragments carry tokens and search terms; the extension
    // strips them, and the Host strips them again so a compromised or buggy
    // companion cannot put them in the store.
    try {
      const url = new URL(raw)
      url.search = ''
      url.hash = ''
      return {
        kind: 'url',
        canonicalUri: url.href,
        ...(message.window?.title ? { displayLabel: message.window.title } : {}),
      }
    } catch { return undefined }
  }
  if (/^file:\/\//i.test(raw)) {
    try {
      const url = new URL(raw)
      return {
        kind: adapter.documentResourceKind,
        canonicalUri: url.href,
        displayLabel: path.basename(decodeURIComponent(url.pathname)),
      }
    } catch { return undefined }
  }
  if (path.isAbsolute(raw)) {
    return {
      kind: adapter.documentResourceKind,
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

/**
 * A window title that is nothing but a file name: no whitespace, no directory
 * separator, and a short extension. Editors title a window this way when they
 * have no document to offer.
 */
export function looksLikeBareFileName(title: string): boolean {
  if (/\s/.test(title)) return false
  if (title.includes('/')) return false
  return /^[^\s/]+\.[A-Za-z0-9]{1,8}$/.test(title)
}

/**
 * Why an observation was not stored. Silently returning `undefined` made several
 * different decisions look identical, which cost a round: a test asserting "the
 * lock screen is not recorded" passed whether or not the mechanism it named was
 * working.
 */
/** How far ahead of the host's clock a collector's timestamp may be before it is refused by name. */
const CLOCK_SKEW_TOLERANCE_MS = 5_000

export type RefusalReason =
  | 'secure-field'
  | 'protected-app'
  | 'protected-metadata'
  | 'not-an-adapter'
  | 'unknown-adapter'
  | 'unlocatable-name'
  | 'secure-path'
  | 'policy'
  /**
   * A browser seen through Accessibility while no companion is paired: the path cannot tell a private
   * window from a normal one (ADR 0007), so nothing is stored. Named rather than silent, because the
   * advice is "pair the companion" and an unattributed count cannot say that.
   */
  | 'browser-unpaired'
  /**
   * A timestamp further ahead than a collector's clock can be trusted to be. Measured 2026-10-05: a Linux
   * collector inside a VM ran 354 ms ahead of its host, which is ordinary clock skew between machines - and
   * the host used to discard those observations silently, so a remote collector looked like a machine nobody
   * used.
   */
  | 'future-timestamp'
  /** Older than the retention window: arrived, but too late to be stored. */
  | 'expired'
  /** A refusal nothing attributed: visible rather than silent. */
  | 'unknown'

export interface RefusalReport {
  reason?: RefusalReason
}

/**
 * F13 (ADR 0008). When the user has declared protected paths and a window
 * offers only a bare file name, the Host cannot tell whether that file lives
 * under one of them, so the name is not stored. This only ever drops an
 * observation: nothing becomes storable that was not storable before.
 */
export function isUnlocatableFileName(
  message: NativeObservation,
  resource: ResourceIdentity | undefined,
  policy: PolicySnapshot,
): boolean {
  if (resource) return false
  const title = message.window?.title
  if (!title || !looksLikeBareFileName(title)) return false
  return policy.rules.some(rule =>
    rule.dimension === 'resource' && rule.action !== 'allow',
  )
}

export function normalizeObservation(
  message: NativeObservation,
  policy: PolicySnapshot,
  nowMs: number,
  workspace: WorkspaceRef = { source: 'none', confidence: 0 },
  resourceOverride?: ResourceIdentity,
  // Stamped at insert time, so a later change of the setting governs what is
  // recorded from then on rather than reaching back into stored history.
  observationRetentionMs: number = OBSERVATION_RETENTION_MS,
  /**
   * Where to record why an observation was refused. A decision that is not
   * reported cannot be checked: "the policy refused it", "it is a password
   * manager" and "that bundle is not an adapter" are different facts (T2.9-3).
   */
  refusal?: RefusalReport,
): ActivityObservation | undefined {
  const refuse = (reason: RefusalReason): undefined => {
    if (refusal) refusal.reason = reason
    return undefined
  }

  // A protected collector observation carries the reason the protocol documents; without this the
  // refusal breakdown calls every protected application a secure field, which is the label the
  // fixture reserves for an unreadable secure surface (tests/conformance/fixtures/adapters.json).
  if (
    message.privacy.protected
    && message.privacy.reason === 'protected-app'
  ) return refuse('protected-app')
  if (message.privacy.secure || message.privacy.protected) return refuse('secure-field')
  if (PROTECTED_BUNDLES.has(message.app.bundleId)) return refuse('protected-app')
  if (isProtectedMetadata(message, policy)) return refuse('protected-metadata')
  const safeAdapter = phase1AdapterForBundle(message.app.bundleId)
  if (!safeAdapter) return refuse('not-an-adapter')
  const adapter = phase1AdapterDefinition(safeAdapter)
  if (!adapter) return refuse('unknown-adapter')
  const resource = resourceOverride
    ?? resourceOf(message, adapter)
  if (isUnlocatableFileName(message, resource, policy)) return refuse('unlocatable-name')
  // A URL resource is accepted only from the paired companion (ADR 0007). The
  // Accessibility path still cannot tell a private window from a normal one, so
  // a browser seen through AX keeps contributing nothing.
  const provider = message.source.provider ?? 'macos-ax'
  if (
    resource?.kind === 'url'
    && provider !== 'companion'
  ) return refuse('browser-unpaired')
  if (
    resource?.kind === 'file'
    || resource?.kind === 'directory'
  ) {
    try {
      if (SECURE_PATH.test(decodeURIComponent(new URL(resource.canonicalUri).pathname))) return refuse('secure-path')
    } catch { return undefined }
  }
  if (!policyAllows(message.app.bundleId, resource, policy)) return refuse('policy')

  // A collector on another machine keeps its own clock, so "in the future" has to mean "beyond what skew
  // explains" rather than "any millisecond ahead of mine". The same-machine collectors never trip this; the
  // remote ones did, and the drop was silent.
  if (message.observedAtMs > nowMs + CLOCK_SKEW_TOLERANCE_MS) {
    return refuse('future-timestamp')
  }

  const expiresAtMs = message.observedAtMs + observationRetentionMs
  if (
    !Number.isSafeInteger(expiresAtMs)
    || expiresAtMs <= nowMs
  ) return refuse('expired')

  return {
    collectorSessionId: CollectorSessionId(message.collectorSession),
    seq: message.seq,
    observedAtMs: message.observedAtMs,
    app: { pid: message.app.pid, bundleId: message.app.bundleId, ...(message.app.name ? { displayName: message.app.name } : {}) },
    surface: {
      kind: adapter.surfaceKind,
      ...(
        !adapter.suppressesWindowTitle
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
    source: { provider, adapter: safeAdapter },
    policyRevision: policy.revision,
    expiresAtMs,
  }
}
