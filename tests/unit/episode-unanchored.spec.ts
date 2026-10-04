// The Windows session of 2026-10-05, replayed as a regression case.
//
// Provenance: the Host on the real Windows machine stored these thirteen observations and produced **no
// episode at all** (`episodes` and `episode_surfaces` were empty, `/api/computer-history/recent` answered
// `[]`). Every row has `resource_id = null`, because Windows has no `kAXDocument` equivalent, the browser
// companion was unpaired and nothing carried a DSH workspace.
//
// The behaviour these cases pin is the one the product needs: **a session without anchors is still a
// session.** It fails today - `buildEpisodes` returns nothing for rows like these - and the failure is the
// reason the Windows validation row cannot be green.
import { describe, expect, it } from 'vitest'
import {
  CollectorSessionId,
  type ActivityObservation,
  type ObservationAdapter,
  type ObservationId,
} from '../../src/shared/index.js'
import {
  buildEpisodes,
  type PersistedActivityObservation,
} from '../../src/host/episodes/index.js'

type Row = readonly [
  id: number,
  session: string,
  seq: number,
  atMs: number,
  bundleId: string,
  surfaceKind: ActivityObservation['surface']['kind'],
  idleSeconds: number,
]

/** Copied from the machine's `observations` table, oldest first, unchanged. */
const WINDOWS_SESSION: readonly Row[] = [
  [1, 'win-30844', 1, 1791130041272, 'Notepad.exe', 'editor', 326],
  [2, 'win-30844', 2, 1791130044180, 'explorer.exe', 'window', 329],
  [3, 'win-30844', 3, 1791130054200, 'WindowsTerminal.exe', 'terminal', 339],
  [4, 'win-30844', 4, 1791130064224, 'Notepad.exe', 'editor', 349],
  [5, 'win-3792', 2, 1791130912720, 'explorer.exe', 'window', 1197],
  [6, 'win-3792', 3, 1791130964336, 'explorer.exe', 'window', 1249],
  [7, 'win-3792', 4, 1791130967841, 'Notepad.exe', 'editor', 1252],
  [8, 'win-3792', 5, 1791130977861, 'explorer.exe', 'window', 1262],
  [9, 'win-3792', 6, 1791130982877, 'WindowsTerminal.exe', 'terminal', 1267],
  [10, 'win-3792', 7, 1791131022948, 'explorer.exe', 'window', 1307],
  [11, 'win-3792', 10, 1791131103152, 'WindowsTerminal.exe', 'terminal', 1388],
  [12, 'win-3792', 12, 1791131674227, 'WindowsTerminal.exe', 'terminal', 1959],
  [13, 'win-3792', 13, 1791131889707, 'WindowsTerminal.exe', 'terminal', 3],
]

/** The adapter the machine reported for each bundle, as stored. */
const ADAPTERS: Record<string, ObservationAdapter> = {
  'Notepad.exe': 'notepad',
  'explorer.exe': 'finder',
  'WindowsTerminal.exe': 'terminal',
}

function storedObservation(row: Row): PersistedActivityObservation {
  const [id, session, seq, atMs, bundleId, kind, idleSeconds] = row
  return {
    id: id as ObservationId,
    collectorSessionId: CollectorSessionId(session),
    seq,
    observedAtMs: atMs,
    app: { pid: 100 + id, bundleId },
    surface: { kind },
    workspace: { source: 'none', confidence: 0 },
    activity: { idleSeconds },
    privacy: { secure: false, protected: false },
    source: { provider: 'macos-ax', adapter: ADAPTERS[bundleId] ?? 'generic' },
    policyRevision: 2,
    expiresAtMs: atMs + 86_400_000,
  }
}

describe('a stored Windows session with no resources', () => {
  const observations = WINDOWS_SESSION.map(storedObservation)

  it('is still a session: it produces episodes', () => {
    const episodes = buildEpisodes(observations)

    expect(
      episodes.length,
      'thirteen stored observations produced no episode at all',
    ).toBeGreaterThan(0)
  })

  it('separates the applications the user actually switched between', () => {
    const episodes = buildEpisodes(observations)
    const apps = new Set(
      episodes.flatMap(episode =>
        episode.surfaces.map(surface => surface.bundleId),
      ),
    )

    expect(apps).toContain('Notepad.exe')
    expect(apps).toContain('explorer.exe')
    expect(apps).toContain('WindowsTerminal.exe')
  })

  it('closes an episode at the eight minute idle boundary rather than merging the day', () => {
    const episodes = buildEpisodes(observations)

    expect(
      episodes.some(episode => episode.boundary.endReason === 'idle'),
    ).toBe(true)
    // The first four rows were taken minutes after the user stopped typing (idle 326-349 s), the rows from
    // the restarted collector 20-32 minutes later. Both halves are real activity; neither may be dropped.
    expect(episodes.every(episode => episode.observationIds.length >= 1)).toBe(true)
  })
})
