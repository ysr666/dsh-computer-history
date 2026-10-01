import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CollectorSessionId,
  type ObservationId,
} from '../../src/shared/index.js'
import {
  buildEpisodes,
  type PersistedActivityObservation,
} from '../../src/host/episodes/index.js'

function value(
  id: number,
  workspace: 'alpha' | 'beta',
  atMs: number,
): PersistedActivityObservation {
  return {
    id: id as ObservationId,
    collectorSessionId: CollectorSessionId('collector-property'),
    seq: id,
    observedAtMs: atMs,
    app: {
      pid: 100,
      bundleId: 'com.microsoft.VSCode',
    },
    surface: {
      kind: 'editor',
    },
    resource: {
      kind: 'file',
      canonicalUri: `file:///${workspace}/src/${id}.ts`,
      displayLabel: `${id}.ts`,
    },
    workspace: {
      id: workspace,
      root: `/${workspace}`,
      title: workspace,
      source: 'dsh',
      confidence: 1,
    },
    activity: {},
    privacy: {
      secure: false,
      protected: false,
    },
    source: {
      provider: 'macos-ax',
      adapter: 'vscode',
    },
    policyRevision: 1,
    expiresAtMs: atMs + 86_400_000,
  }
}

describe('episode builder properties', () => {
  it('is deterministic for arbitrary input ordering', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<'alpha' | 'beta'>('alpha', 'beta'), {
          minLength: 1,
          maxLength: 30,
        }),
        (workspaces) => {
          const observations = workspaces.map((workspace, index) =>
            value(index + 1, workspace, (index + 1) * 1_000),
          )

          expect(buildEpisodes(observations)).toEqual(
            buildEpisodes(observations.toReversed()),
          )
        },
      ),
      { numRuns: 100 },
    )
  })

  it('is idempotent for repeated identical persisted observations', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'alpha' | 'beta'>('alpha', 'beta'),
        fc.integer({ min: 1, max: 10_000 }),
        (workspace, atMs) => {
          const observation = value(1, workspace, atMs)
          expect(buildEpisodes([observation, observation])).toEqual(
            buildEpisodes([observation]),
          )
        },
      ),
      { numRuns: 50 },
    )
  })
})
