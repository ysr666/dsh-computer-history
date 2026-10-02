import { describe, expect, it } from 'vitest'
import {
  CollectorSessionId,
  type ActivityObservation,
  type ObservationId,
} from '../../src/shared/index.js'
import {
  buildEpisodes,
  type PersistedActivityObservation,
} from '../../src/host/episodes/index.js'

function observation(input: {
  id: number
  atMs: number
  workspace?: string
  resource?: string
  resourceKind?: 'file' | 'directory' | 'url'
  app?: string
  surface?: ActivityObservation['surface']['kind']
  collector?: string
  idleSeconds?: number
  secure?: boolean
  protected?: boolean
}): PersistedActivityObservation {
  const workspace = input.workspace
  const source = workspace ? 'dsh' as const : 'none' as const
  const kind = input.resourceKind
    ?? (input.resource?.startsWith('http') ? 'url' : 'file')

  return {
    id: input.id as ObservationId,
    collectorSessionId: CollectorSessionId(
      input.collector ?? 'collector-1',
    ),
    seq: input.id,
    observedAtMs: input.atMs,
    app: {
      pid: 100 + input.id,
      bundleId: input.app ?? 'com.microsoft.VSCode',
    },
    surface: {
      kind: input.surface ?? 'editor',
    },
    ...(input.resource
      ? {
          resource: {
            kind,
            canonicalUri: input.resource,
            displayLabel: input.resource.split('/').at(-1) ?? input.resource,
          },
        }
      : {}),
    workspace: workspace
      ? {
          id: workspace,
          root: `/${workspace}`,
          title: workspace,
          source,
          confidence: 1,
        }
      : {
          source,
          confidence: 0,
        },
    activity: input.idleSeconds === undefined
      ? {}
      : { idleSeconds: input.idleSeconds },
    privacy: {
      secure: input.secure ?? false,
      protected: input.protected ?? false,
    },
    source: {
      provider: 'macos-ax',
      adapter: 'generic',
    },
    policyRevision: 1,
    expiresAtMs: input.atMs + 86_400_000,
  }
}

describe('deterministic episode builder', () => {
  it('keeps Code, Terminal, and Preview resources in one workspace episode', () => {
    const episodes = buildEpisodes([
      observation({
        id: 1,
        atMs: 1_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
        app: 'com.microsoft.VSCode',
        surface: 'editor',
      }),
      observation({
        id: 2,
        atMs: 2_000,
        workspace: 'alpha',
        resource: 'file:///alpha',
        resourceKind: 'directory',
        app: 'com.apple.Terminal',
        surface: 'terminal',
      }),
      observation({
        id: 3,
        atMs: 3_000,
        workspace: 'alpha',
        resource: 'file:///alpha/spec.pdf',
        app: 'com.apple.Preview',
        surface: 'document',
      }),
    ])

    expect(episodes).toHaveLength(1)
    expect(episodes[0]?.workspace?.id).toBe('alpha')
    expect(episodes[0]?.resources).toHaveLength(3)
    expect(episodes[0]?.surfaces).toHaveLength(3)
    expect(episodes[0]?.threadKey).toBe('workspace:alpha')
  })

  it('splits a strong workspace switch immediately, including A -> B -> A', () => {
    const episodes = buildEpisodes([
      observation({
        id: 1,
        atMs: 1_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
      }),
      observation({
        id: 2,
        atMs: 2_000,
        workspace: 'beta',
        resource: 'file:///beta/src/provider.ts',
      }),
      observation({
        id: 3,
        atMs: 3_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
      }),
    ])

    expect(episodes.map((item) => item.workspace?.id)).toEqual([
      'alpha',
      'beta',
      'alpha',
    ])
    expect(episodes.map((item) => item.boundary.endReason)).toEqual([
      'workspace-switch',
      'workspace-switch',
      'timeout',
    ])
    expect(new Set(episodes.map((item) => item.id)).size).toBe(3)
  })

  it('ignores a short resource-less detour without splitting the episode', () => {
    const episodes = buildEpisodes([
      observation({
        id: 1,
        atMs: 1_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
      }),
      observation({
        id: 2,
        atMs: 30_000,
        app: 'com.apple.Notes',
        surface: 'window',
      }),
      observation({
        id: 3,
        atMs: 60_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
      }),
    ])

    expect(episodes).toHaveLength(1)
    expect(episodes[0]?.observationIds).toEqual([1, 3])
  })

  it('splits when a resource-less detour exceeds the grace window', () => {
    const episodes = buildEpisodes([
      observation({
        id: 1,
        atMs: 1_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
      }),
      observation({
        id: 2,
        atMs: 20_000,
        app: 'com.apple.Notes',
        surface: 'window',
      }),
      observation({
        id: 3,
        atMs: 100_500,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
      }),
    ])

    expect(episodes).toHaveLength(2)
    expect(episodes[0]?.boundary.endReason).toBe('timeout')
    expect(episodes[1]?.boundary.startReason).toBe('timeout')
  })

  it('splits on idle and collector restart boundaries', () => {
    const idle = buildEpisodes([
      observation({
        id: 1,
        atMs: 1_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
      }),
      observation({
        id: 2,
        atMs: 2_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
        idleSeconds: 500,
      }),
    ])

    expect(idle).toHaveLength(2)
    expect(idle[0]?.boundary.endReason).toBe('idle')
    expect(idle[1]?.boundary.startReason).toBe('idle')

    const restarted = buildEpisodes([
      observation({
        id: 1,
        atMs: 1_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
        collector: 'collector-1',
      }),
      observation({
        id: 2,
        atMs: 2_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
        collector: 'collector-2',
      }),
    ])

    expect(restarted).toHaveLength(2)
    expect(restarted[0]?.boundary.endReason).toBe('collector-restart')
    expect(restarted[1]?.boundary.startReason).toBe('collector-restart')
  })

  it('keeps same-named resources in different workspaces separate', () => {
    const episodes = buildEpisodes([
      observation({
        id: 1,
        atMs: 1_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
      }),
      observation({
        id: 2,
        atMs: 2_000,
        workspace: 'beta',
        resource: 'file:///beta/src/provider.ts',
      }),
    ])

    expect(episodes).toHaveLength(2)
    expect(episodes[0]?.resources[0]?.canonicalUri).toBe(
      'file:///alpha/src/provider.ts',
    )
    expect(episodes[1]?.resources[0]?.canonicalUri).toBe(
      'file:///beta/src/provider.ts',
    )
  })

  it('attaches a recent unanchored URL but splits a stale one', () => {
    const attached = buildEpisodes([
      observation({
        id: 1,
        atMs: 1_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
      }),
      observation({
        id: 2,
        atMs: 30_000,
        resource: 'https://docs.example/retry',
        resourceKind: 'url',
        app: 'com.google.Chrome',
        surface: 'browser',
      }),
    ])

    expect(attached).toHaveLength(1)
    expect(attached[0]?.resources).toHaveLength(2)

    const stale = buildEpisodes([
      observation({
        id: 1,
        atMs: 1_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
      }),
      observation({
        id: 2,
        atMs: 100_500,
        resource: 'https://docs.example/retry',
        resourceKind: 'url',
        app: 'com.google.Chrome',
        surface: 'browser',
      }),
    ])

    expect(stale).toHaveLength(2)
    expect(stale[1]?.workspace).toBeUndefined()
  })

  it('does not admit secure or protected observations', () => {
    const episodes = buildEpisodes([
      observation({
        id: 1,
        atMs: 1_000,
        workspace: 'secret',
        resource: 'file:///secret/password.txt',
        secure: true,
      }),
      observation({
        id: 2,
        atMs: 2_000,
        workspace: 'secret',
        resource: 'file:///secret/keychain.txt',
        protected: true,
      }),
    ])

    expect(episodes).toEqual([])
  })

  it('is deterministic across input order', () => {
    const values = [
      observation({
        id: 1,
        atMs: 1_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
      }),
      observation({
        id: 2,
        atMs: 2_000,
        workspace: 'alpha',
        resource: 'file:///alpha',
        resourceKind: 'directory',
        app: 'com.apple.Terminal',
        surface: 'terminal',
      }),
      observation({
        id: 3,
        atMs: 3_000,
        workspace: 'beta',
        resource: 'file:///beta/src/provider.ts',
      }),
    ]

    expect(buildEpisodes(values)).toEqual(
      buildEpisodes(values.toReversed()),
    )
  })

  it('rejects conflicting data for the same collector session and sequence', () => {
    const first = observation({
      id: 1,
      atMs: 1_000,
      workspace: 'alpha',
      resource: 'file:///alpha/src/provider.ts',
    })
    const conflicting = {
      ...first,
      resource: {
        kind: 'file' as const,
        canonicalUri: 'file:///alpha/src/different.ts',
      },
    }

    expect(() => buildEpisodes([first, conflicting])).toThrow(
      /conflicting duplicate observation/,
    )
  })

  it('is idempotent when the same persisted observation is repeated', () => {
    const value = observation({
      id: 1,
      atMs: 1_000,
      workspace: 'alpha',
      resource: 'file:///alpha/src/provider.ts',
    })

    expect(buildEpisodes([value, value])).toEqual(
      buildEpisodes([value]),
    )
  })
})

describe('document-less observations (Phase 1 validation, seq 1-2)', () => {
  // The real-machine run that opened a file in VS Code produced:
  //   seq 1  "Visual Studio Code"  no resource, no workspace
  //   seq 2  "normal-text.html"    no resource, no workspace
  //   seq 3  "normal-text.html"    resource file:///…/normal-text.html
  // The first two are stored as evidence but anchor no episode: at that moment
  // the collector had not read a document yet, and the episode must not claim
  // a workspace it never observed. These tests pin that decision; T2.0-7 owns
  // the question of whether such an early observation should later be adopted
  // by the episode its window turns out to belong to.
  it('keeps an early document-less observation out of the episode its successor anchors', () => {
    const episodes = buildEpisodes([
      observation({ id: 1, atMs: 1_000 }),
      observation({
        id: 2,
        atMs: 6_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/normal-text.html',
      }),
    ])

    expect(episodes).toHaveLength(1)
    const episode = episodes[0]!
    expect(episode.observationIds).toEqual([2])
    expect(episode.startedAtMs).toBe(6_000)
    expect(episode.workspace?.root).toBe('/alpha')
    expect(episode.resources.map(item => item.canonicalUri)).toEqual([
      'file:///alpha/src/normal-text.html',
    ])
  })

  it('treats a document-less observation inside an episode as a detour', () => {
    const episodes = buildEpisodes([
      observation({
        id: 1,
        atMs: 1_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
      }),
      observation({ id: 2, atMs: 4_000 }),
      observation({
        id: 3,
        atMs: 9_000,
        workspace: 'alpha',
        resource: 'file:///alpha/src/provider.ts',
      }),
    ])

    expect(episodes).toHaveLength(1)
    // The middle observation is not silently promoted into the episode: it
    // marks a detour window and stays evidence-only.
    expect(episodes[0]!.observationIds).toEqual([1, 3])
  })
})
