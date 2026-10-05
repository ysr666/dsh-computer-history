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

/**
 * The surface title is what makes a timeline readable on a platform with no resource to anchor to.
 *
 * Measured on the Windows machine: `/recent` carried `resources: []` on every row and showed
 * `Notepad.exe · editor` for every Notepad window of the day, while `observations.window_title` had been
 * storing `无标题 - Notepad` and `47209 - 文件资源管理器` all along. The title reaches the surface now, and the
 * two rules that must not change with it are asserted here: an adapter that suppresses its titles
 * (terminals carry a working directory) contributes none, and an observation without one cannot erase a
 * title the surface already had.
 */
function observation(input: {
  id: number
  atMs: number
  app?: string
  kind?: ActivityObservation['surface']['kind']
  title?: string | null
}): PersistedActivityObservation {
  return {
    id: input.id as ObservationId,
    collectorSessionId: CollectorSessionId('collector-1'),
    seq: input.id,
    observedAtMs: input.atMs,
    app: { pid: 100 + input.id, bundleId: input.app ?? 'Notepad.exe' },
    surface: {
      kind: input.kind ?? 'editor',
      ...(input.title === undefined || input.title === null
        ? {}
        : { title: input.title }),
    },
    workspace: { source: 'none' as const, confidence: 0 },
    activity: {},
    privacy: { secure: false, protected: false },
    source: { provider: 'windows-uia', adapter: 'generic' },
    policyRevision: 1,
    expiresAtMs: input.atMs + 86_400_000,
  }
}

describe('a surface carries the window title it had', () => {
  it('puts the title on the surface summary', () => {
    const episodes = buildEpisodes([
      observation({ id: 1, atMs: 1_000, title: '无标题 - Notepad' }),
      observation({ id: 2, atMs: 4_000, title: 'notes.txt - Notepad' }),
    ])

    expect(episodes).toHaveLength(1)
    expect(episodes[0]?.surfaces).toEqual([{
      bundleId: 'Notepad.exe',
      surfaceKind: 'editor',
      // The newest title wins: the window was renamed, and the timeline should say what it was called last.
      title: 'notes.txt - Notepad',
      firstSeenAtMs: 1_000,
      lastSeenAtMs: 4_000,
      observationCount: 2,
    }])
  })

  it('carries no title for an adapter that suppresses them', () => {
    // `suppressesWindowTitle` is applied during ingestion: a terminal's title holds a working directory, so
    // the observation arrives without one and the surface must not invent it.
    const episodes = buildEpisodes([
      observation({ id: 1, atMs: 1_000, app: 'WindowsTerminal.exe', kind: 'terminal' }),
      observation({ id: 2, atMs: 4_000, app: 'WindowsTerminal.exe', kind: 'terminal' }),
    ])

    expect(episodes).toHaveLength(1)
    const surface = episodes[0]?.surfaces.at(0)
    expect(surface?.surfaceKind).toBe('terminal')
    expect(surface).not.toHaveProperty('title')
    expect(JSON.stringify(episodes[0])).not.toContain('title')
  })

  it('keeps the last title when a later observation has none', () => {
    const episodes = buildEpisodes([
      observation({ id: 1, atMs: 1_000, title: 'notes.txt - Notepad' }),
      observation({ id: 2, atMs: 4_000, title: null }),
    ])

    expect(episodes).toHaveLength(1)
    expect(episodes[0]?.surfaces.at(0)?.title).toBe('notes.txt - Notepad')
  })
})
