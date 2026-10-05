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


export const SECURE_PATH = /(?:^|\/)(?:\.env(?:\.|$)|\.ssh(?:\/|$)|\.netrc$|\.npmrc$|id_(?:rsa|ed25519|ecdsa|dsa)$|service-account\.json$)|\.(?:pem|key|p12|pfx|jks|keystore)$|(?:credentials|secrets)/i

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

function hasProtectedRawResourceMetadata(
  message: NativeObservation,
  policy: PolicySnapshot,
): boolean {
  for (const value of [message.window?.document, message.window?.url]) {
    if (value && isProtectedText(value, policy)) return true
  }
  return false
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
  | 'unreadable-resource'
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
  /**
   * The four refusals the companion path decides before ingestion ever sees the payload: capture switched off,
   * another Host owning capture, the user pausing, and a collector that is not running. They reached the client
   * as `202 {"stored":false}` and nothing else, so "paused" and "the Host refused this app" looked identical -
   * to the client, to its log and to the refusal counts.
   */
  | 'capture-disabled'
  | 'capture-not-owned'
  | 'capture-paused'
  | 'collector-not-running'
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
function isUnlocatableTitle(
  title: string | undefined,
  resource: ResourceIdentity | undefined,
  policy: PolicySnapshot,
): boolean {
  if (resource) return false
  if (!title || !looksLikeBareFileName(title)) return false
  return policy.rules.some(rule =>
    rule.dimension === 'resource' && rule.action !== 'allow',
  )
}

export function isUnlocatableFileName(
  message: NativeObservation,
  resource: ResourceIdentity | undefined,
  policy: PolicySnapshot,
): boolean {
  return isUnlocatableTitle(message.window?.title, resource, policy)
}

export type PrivacyMetadataExclusionReason =
  | 'protected-app'
  | 'protected-title'
  | 'protected-metadata'

export type PrivacyPolicyExclusionReason =
  | PrivacyMetadataExclusionReason
  | 'unlocatable-name'
  | 'browser-unpaired'
  | 'secure-path'
  | 'unreadable-resource'
  | 'policy'

export interface PrivacyPolicyCandidate {
  readonly bundleId: string
  readonly title?: string
  readonly elementIdentifier?: string
  readonly resource?: ResourceIdentity
  readonly provider: NonNullable<NativeObservation['source']>['provider']
}

export function classifyPrivacyMetadataExclusion(
  candidate: Pick<
    PrivacyPolicyCandidate,
    'bundleId' | 'title' | 'elementIdentifier'
  >,
  policy: PolicySnapshot,
): PrivacyMetadataExclusionReason | undefined {
  if (PROTECTED_BUNDLES.has(candidate.bundleId)) return 'protected-app'
  if (candidate.title && isProtectedTitle(candidate.title, policy)) {
    return 'protected-title'
  }
  if (
    candidate.elementIdentifier
    && isProtectedText(candidate.elementIdentifier, policy)
  ) {
    return 'protected-metadata'
  }
  return undefined
}

/**
 * One source of truth for the privacy/policy decisions that can be re-run over
 * already-normalised metadata. Ingestion calls this before storing; the Privacy
 * Check calls the same function over stored rows. Raw collector-only fields and
 * retention/clock checks remain outside because they cannot be reconstructed
 * from a stored observation and are not policy-preview questions.
 */
export function classifyPrivacyPolicyExclusion(
  candidate: PrivacyPolicyCandidate,
  policy: PolicySnapshot,
): PrivacyPolicyExclusionReason | undefined {
  const metadataReason = classifyPrivacyMetadataExclusion(candidate, policy)
  if (metadataReason) return metadataReason
  if (isUnlocatableTitle(candidate.title, candidate.resource, policy)) {
    return 'unlocatable-name'
  }
  if (candidate.resource?.kind === 'url' && candidate.provider !== 'companion') {
    return 'browser-unpaired'
  }
  if (
    candidate.resource?.kind === 'file'
    || candidate.resource?.kind === 'directory'
  ) {
    try {
      const pathname = decodeURIComponent(
        new URL(candidate.resource.canonicalUri).pathname,
      )
      if (SECURE_PATH.test(pathname)) return 'secure-path'
    } catch {
      return 'unreadable-resource'
    }
  }
  if (!policyAllows(candidate.bundleId, candidate.resource, policy)) {
    return 'policy'
  }
  return undefined
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
  if (hasProtectedRawResourceMetadata(message, policy)) {
    return refuse('protected-metadata')
  }
  const metadataExclusion = classifyPrivacyMetadataExclusion({
    bundleId: message.app.bundleId,
    ...(message.window?.title ? { title: message.window.title } : {}),
    ...(message.element?.identifier
      ? { elementIdentifier: message.element.identifier }
      : {}),
  }, policy)
  if (metadataExclusion === 'protected-app') return refuse('protected-app')
  if (metadataExclusion) return refuse('protected-metadata')

  const safeAdapter = phase1AdapterForBundle(message.app.bundleId)
  if (!safeAdapter) return refuse('not-an-adapter')
  const adapter = phase1AdapterDefinition(safeAdapter)
  if (!adapter) return refuse('unknown-adapter')
  const resource = resourceOverride
    ?? resourceOf(message, adapter)
  const provider = message.source.provider ?? 'macos-ax'
  const privacyPolicyExclusion = classifyPrivacyPolicyExclusion({
    bundleId: message.app.bundleId,
    ...(message.window?.title ? { title: message.window.title } : {}),
    ...(message.element?.identifier
      ? { elementIdentifier: message.element.identifier }
      : {}),
    ...(resource ? { resource } : {}),
    provider,
  }, policy)
  if (privacyPolicyExclusion) {
    switch (privacyPolicyExclusion) {
      case 'protected-app': return refuse('protected-app')
      case 'protected-title':
      case 'protected-metadata': return refuse('protected-metadata')
      case 'unlocatable-name': return refuse('unlocatable-name')
      case 'browser-unpaired': return refuse('browser-unpaired')
      case 'secure-path': return refuse('secure-path')
      case 'unreadable-resource': return refuse('unreadable-resource')
      case 'policy': return refuse('policy')
    }
  }

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
