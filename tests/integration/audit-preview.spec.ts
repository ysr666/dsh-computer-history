import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PolicyRuleId, type PolicySnapshot } from '../../src/shared/index.js'
import { buildRedactionPreview } from '../../src/host/audit/preview.js'
import { openHistoryDatabase } from '../../src/host/store/index.js'
import { ObservationStore, ResourceStore } from '../../src/host/store/index.js'
import { CollectorSessionId, type ActivityObservation } from '../../src/shared/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function observation(input: {
  seq: number
  bundleId: string
  title?: string
  uri?: string
  elementIdentifier?: string
}): ActivityObservation {
  return {
    collectorSessionId: CollectorSessionId('preview-1'),
    seq: input.seq,
    observedAtMs: input.seq * 1_000,
    app: { pid: 100 + input.seq, bundleId: input.bundleId },
    surface: {
      kind: 'editor',
      ...(input.title ? { title: input.title } : {}),
    },
    ...(input.elementIdentifier
      ? { element: { identifier: input.elementIdentifier } }
      : {}),
    ...(input.uri
      ? {
          resource: {
            kind: 'file' as const,
            canonicalUri: input.uri,
            // `pop()` is `string | undefined`; the segment is known here.
            displayLabel: input.uri.split('/').pop() ?? input.uri,
          },
        }
      : {}),
    workspace: { source: 'none' as const, confidence: 0 },
    activity: { idleSeconds: 0 },
    privacy: { secure: false, protected: false },
    source: { provider: 'macos-ax' as const, adapter: 'vscode' as const },
    policyRevision: 1,
    expiresAtMs: 999_999_999,
  }
}

function store(extra: readonly ActivityObservation[] = []) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-preview-'))
  roots.push(root)
  const history = openHistoryDatabase({
    dataDirectory: path.join(root, 'history'),
    nowMs: 1,
  })
  const resources = new ResourceStore(history.db)
  const observations = new ObservationStore(history.db)
  const values = [
    observation({ seq: 1, bundleId: 'com.microsoft.VSCode', uri: 'file:///alpha/ok.ts' }),
    observation({ seq: 2, bundleId: 'com.microsoft.VSCode', uri: 'file:///alpha/.env' }),
    observation({ seq: 3, bundleId: 'com.apple.Terminal', title: 'zsh' }),
    observation({ seq: 4, bundleId: 'com.microsoft.VSCode', title: 'notes.txt' }),
    ...extra,
  ]
  for (const value of values) {
    const resourceId = value.resource
      ? resources.upsert(value.resource, value.observedAtMs)
      : undefined
    observations.insert(value, resourceId)
  }
  return { history, observations: observations.listAll() }
}

function policy(rules: PolicySnapshot['rules']): PolicySnapshot {
  return { revision: 3, mode: 'include-only', updatedAtMs: 3, rules }
}

const allowVscode = {
  id: PolicyRuleId('allow-vscode'),
  dimension: 'app' as const,
  action: 'allow' as const,
  matcher: 'exact' as const,
  pattern: 'com.microsoft.VSCode',
  builtIn: false,
  createdAtMs: 1,
  updatedAtMs: 1,
}

describe('redaction preview', () => {
  it('explains what the policy would not have kept', () => {
    const { history, observations } = store()
    const preview = buildRedactionPreview({
      scopeKey: 'app:com.microsoft.VSCode',
      policy: policy([allowVscode]),
      observations,
    })

    // The Terminal row is not allowed by this policy, and the `.env` path is
    // protected by the ingestion predicates themselves.
    const reasons = preview.excluded.map(entry => `${entry.label}: ${entry.reason}`)
    expect(preview.checked).toBe(4)
    expect(reasons.some(entry => entry.includes('zsh'))).toBe(true)
    expect(reasons.some(entry => entry.includes('.env'))).toBe(true)
    expect(preview.excluded.map(entry => entry.reason)).toEqual(
      expect.arrayContaining(['secure-path', 'policy-disallowed']),
    )
    expect(preview.rulesInForce.hasProtectRule).toBe(false)
    history.close()
  })


  it('uses the same title and metadata predicates as ingestion', () => {
    const { history, observations } = store([
      // The secure-path heuristic deliberately does not apply to descriptive
      // titles with whitespace. Preview used to call isProtectedText directly
      // and falsely claimed this row would be excluded.
      observation({
        seq: 5,
        bundleId: 'com.microsoft.VSCode',
        title: 'secrets project notes',
      }),
      // Element identifiers are screened by ingestion too. The old preview
      // ignored them, so an imported/legacy row could be reported as safe.
      observation({
        seq: 6,
        bundleId: 'com.microsoft.VSCode',
        title: 'ordinary window',
        elementIdentifier: '.env',
      }),
    ])
    const preview = buildRedactionPreview({
      scopeKey: 'app:com.microsoft.VSCode',
      policy: policy([allowVscode]),
      observations,
    })

    expect(preview.excluded.some(entry => entry.label === 'secrets project notes')).toBe(false)
    expect(preview.excluded.some(entry =>
      entry.label === 'ordinary window' && entry.reason === 'protected-metadata',
    )).toBe(true)
    history.close()
  })

  it('reports the rules in force and the unplaceable file name', () => {
    const { history, observations } = store()
    const preview = buildRedactionPreview({
      scopeKey: 'app:com.microsoft.VSCode',
      policy: policy([
        allowVscode,
        {
          id: PolicyRuleId('protect-client'),
          dimension: 'resource',
          action: 'deny',
          matcher: 'glob',
          pattern: '/Users/someone/private/*',
          builtIn: false,
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ]),
      observations,
    })

    expect(preview.rulesInForce.hasProtectRule).toBe(true)
    expect(preview.rulesInForce.protectedPatterns).toEqual([
      'deny glob /Users/someone/private/*',
    ])
    expect(preview.rulesInForce.protectedBundleIds.length).toBeGreaterThan(0)
    // F13 in action: with a protect rule in force, the title-only `notes.txt`
    // row counts as one the Host would not keep today.
    expect(
      preview.excluded.some(entry => entry.label.includes('notes.txt')),
    ).toBe(true)
    history.close()
  })

  it('excludes nothing when the policy allows everything stored', () => {
    const { history, observations } = store()
    const preview = buildRedactionPreview({
      scopeKey: 'app:com.microsoft.VSCode',
      policy: policy([
        allowVscode,
        {
          ...allowVscode,
          id: PolicyRuleId('allow-terminal'),
          pattern: 'com.apple.Terminal',
        },
      ]),
      observations,
    })
    // One row is still excluded, and honestly so: the `.env` path is protected
    // by the secure-path rule regardless of the application allow-list.
    expect(preview.excluded.map(entry => entry.label)).toEqual(['.env'])
    history.close()
  })

  it('an include-only policy with no allow rule keeps nothing', () => {
    const { history, observations } = store()
    const preview = buildRedactionPreview({
      scopeKey: 'app:com.microsoft.VSCode',
      policy: policy([]),
      observations,
    })
    expect(preview.checked).toBe(4)
    expect(preview.excluded).toHaveLength(4)
    history.close()
  })
})
