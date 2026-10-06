import type {
  PolicySnapshot,
  RedactionPreview,
  RedactionPreviewEntry,
} from '../../shared/index.js'
import {
  PROTECTED_BUNDLES,
  SECURE_PATH,
  isProtectedText,
  isProtectedWorkspace,
  isUnlocatableFileName,
  policyAllows,
} from '../ingestion/normalize.js'
import type { PersistedActivityObservation } from '../episodes/builder.js'

/**
 * "What would this policy not keep?" — answered by running the ingestion
 * predicates over rows that are already stored, not by a second implementation
 * of them. If this ever disagrees with ingestion, one of the two is a bug and
 * the shared functions make that visible.
 */
export function buildRedactionPreview(input: {
  readonly scopeKey: string
  readonly policy: PolicySnapshot
  readonly observations: readonly PersistedActivityObservation[]
}): RedactionPreview {
  const { policy, observations } = input
  const protectRules = policy.rules.filter(rule =>
    rule.action !== 'allow' && rule.dimension === 'resource',
  )

  const excluded: RedactionPreviewEntry[] = []
  for (const observation of observations) {
    const reason = exclusionReason(observation, policy)
    if (!reason) continue
    excluded.push({
      observationId: Number(observation.id),
      // What a person would call this row: the resource if there is one, then
      // the window title, and only then the application.
      label: observation.resource?.displayLabel
        ?? observation.resource?.canonicalUri
        ?? observation.workspace.title
        ?? observation.surface.title
        ?? observation.app.bundleId,
      bundleId: observation.app.bundleId,
      reason,
    })
  }

  return {
    scopeKey: input.scopeKey,
    policyRevision: policy.revision,
    rulesInForce: {
      protectedBundleIds: [...PROTECTED_BUNDLES].toSorted(),
      protectedPatterns: protectRules
        .map(rule => `${rule.action} ${rule.matcher} ${rule.pattern}`)
        .toSorted(),
      hasProtectRule: protectRules.length > 0,
    },
    checked: observations.length,
    excluded,
  }
}

function exclusionReason(
  observation: PersistedActivityObservation,
  policy: PolicySnapshot,
): string | undefined {
  if (PROTECTED_BUNDLES.has(observation.app.bundleId)) {
    return 'the application is protected by a built-in rule'
  }
  if (!policyAllows(observation.app.bundleId, observation.resource, policy)) {
    return 'the policy does not allow this application or resource'
  }
  if (isProtectedWorkspace(observation.workspace, policy)) {
    return 'the workspace root is denied or protected by resource policy'
  }
  // The same secure-path screen ingestion applies to a resource, so the preview
  // cannot miss a row that ingestion would have dropped.
  const uri = observation.resource?.canonicalUri
  if (uri) {
    try {
      if (SECURE_PATH.test(decodeURIComponent(new URL(uri).pathname))) {
        return 'the path is protected by the secure-path rule'
      }
    } catch {
      return 'the resource could not be read, so it would have been dropped'
    }
  }
  const title = observation.surface.title
  if (title && isProtectedText(title, policy)) {
    return 'the title matches a protected pattern'
  }
  if (
    isUnlocatableFileName(
      {
        v: 1,
        type: 'observation',
        collectorSession: '',
        seq: 0,
        observedAtMs: observation.observedAtMs,
        app: {
          pid: observation.app.pid,
          bundleId: observation.app.bundleId,
        },
        ...(title ? { window: { title } } : {}),
        privacy: {
          secure: observation.privacy.secure,
          protected: observation.privacy.protected,
        },
        source: { adapter: observation.source.adapter },
      },
      observation.resource,
      policy,
    )
  ) {
    return 'the window offered a file name the Host cannot place (ADR 0008)'
  }
  return undefined
}
