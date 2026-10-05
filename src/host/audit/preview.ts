import type {
  PolicySnapshot,
  RedactionPreview,
  RedactionPreviewEntry,
  RedactionReason,
} from '../../shared/index.js'
import {
  classifyPrivacyPolicyExclusion,
  PROTECTED_BUNDLES,
  type PrivacyPolicyExclusionReason,
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

function redactionReason(
  reason: PrivacyPolicyExclusionReason,
): RedactionReason {
  switch (reason) {
    case 'protected-app': return 'built-in-protected-app'
    case 'protected-title': return 'protected-title'
    case 'protected-metadata': return 'protected-metadata'
    case 'unlocatable-name': return 'unlocatable-file-name'
    case 'browser-unpaired': return 'browser-unpaired'
    case 'secure-path': return 'secure-path'
    case 'unreadable-resource': return 'unreadable-resource'
    case 'policy': return 'policy-disallowed'
  }
}

function exclusionReason(
  observation: PersistedActivityObservation,
  policy: PolicySnapshot,
): RedactionReason | undefined {
  const reason = classifyPrivacyPolicyExclusion({
    bundleId: observation.app.bundleId,
    ...(observation.surface.title ? { title: observation.surface.title } : {}),
    ...(observation.element?.identifier
      ? { elementIdentifier: observation.element.identifier }
      : {}),
    ...(observation.resource ? { resource: observation.resource } : {}),
    provider: observation.source.provider,
  }, policy)
  return reason ? redactionReason(reason) : undefined
}
