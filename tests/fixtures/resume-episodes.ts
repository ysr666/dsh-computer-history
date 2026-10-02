import {
  EpisodeId,
  type EpisodeSummary,
} from '../../src/shared/index.js'

function episode(input: {
  id: string
  workspace: string
  endedAtMs: number
  resources: readonly {
    kind: 'file' | 'url'
    uri: string
    label: string
  }[]
  surfaces: readonly {
    bundleId: string
    surfaceKind: 'editor' | 'terminal' | 'browser' | 'document'
    lastSeenAtMs: number
  }[]
}): EpisodeSummary {
  return {
    id: EpisodeId(input.id),
    summaryObservationIds: [1 as never],
    startedAtMs: input.endedAtMs - 1_000,
    endedAtMs: input.endedAtMs,
    boundary: {
      startReason: 'first-observation',
      endReason: 'timeout',
    },
    workspace: {
      id: input.workspace,
      root: `/${input.workspace}`,
      title: input.workspace,
    },
    threadKey: `workspace:${input.workspace}`,
    summaryKind: 'deterministic',
    summary: `Worked in ${input.workspace}.`,
    resources: input.resources.map((resource) => ({
      kind: resource.kind,
      canonicalUri: resource.uri,
      displayLabel: resource.label,
      firstSeenAtMs: input.endedAtMs - 900,
      lastSeenAtMs: input.endedAtMs - 100,
      observationCount: 1,
    })),
    surfaces: input.surfaces.map((surface) => ({
      bundleId: surface.bundleId,
      surfaceKind: surface.surfaceKind,
      firstSeenAtMs: surface.lastSeenAtMs - 200,
      lastSeenAtMs: surface.lastSeenAtMs,
      observationCount: 1,
    })),
    confidence: 1,
    state: 'closed',
  }
}

export const resumeEpisodes: readonly EpisodeSummary[] = [
  episode({
    id: 'alpha-old',
    workspace: 'alpha',
    endedAtMs: 2_000,
    resources: [{
      kind: 'url',
      uri: 'https://docs.example/retry.html',
      label: 'retry.html',
    }],
    surfaces: [{
      bundleId: 'com.google.Chrome',
      surfaceKind: 'browser',
      lastSeenAtMs: 1_900,
    }],
  }),
  episode({
    id: 'beta',
    workspace: 'beta',
    endedAtMs: 3_000,
    resources: [
      {
        kind: 'file',
        uri: 'file:///beta/src/provider.ts',
        label: 'provider.ts',
      },
      {
        kind: 'url',
        uri: 'https://docs.example/retry.html',
        label: 'retry.html',
      },
    ],
    surfaces: [
      {
        bundleId: 'com.microsoft.VSCode',
        surfaceKind: 'editor',
        lastSeenAtMs: 2_800,
      },
      {
        bundleId: 'com.apple.Terminal',
        surfaceKind: 'terminal',
        lastSeenAtMs: 2_900,
      },
    ],
  }),
  episode({
    id: 'gamma',
    workspace: 'gamma',
    endedAtMs: 4_000,
    resources: [
      {
        kind: 'file',
        uri: 'file:///gamma/src/server.ts',
        label: 'server.ts',
      },
      {
        kind: 'url',
        uri: 'https://docs.example/deploy.html',
        label: 'deploy.html',
      },
    ],
    surfaces: [
      {
        bundleId: 'com.microsoft.VSCode',
        surfaceKind: 'editor',
        lastSeenAtMs: 3_500,
      },
      {
        bundleId: 'com.google.Chrome',
        surfaceKind: 'browser',
        lastSeenAtMs: 3_900,
      },
      {
        bundleId: 'com.apple.Terminal',
        surfaceKind: 'terminal',
        lastSeenAtMs: 4_000,
      },
    ],
  }),
  episode({
    id: 'alpha-new',
    workspace: 'alpha',
    endedAtMs: 5_000,
    resources: [
      {
        kind: 'file',
        uri: 'file:///alpha/src/provider.ts',
        label: 'provider.ts',
      },
      {
        kind: 'file',
        uri: 'file:///alpha/spec.pdf',
        label: 'spec.pdf',
      },
    ],
    surfaces: [
      {
        bundleId: 'com.apple.Preview',
        surfaceKind: 'document',
        lastSeenAtMs: 4_500,
      },
      {
        bundleId: 'com.microsoft.VSCode',
        surfaceKind: 'editor',
        lastSeenAtMs: 5_000,
      },
    ],
  }),
]
