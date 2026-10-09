import { describe, expect, it } from 'vitest'
import {
  EpisodeId, type EpisodeSummary, type ObservationId,
} from '../../src/shared/index.js'
import { buildThreadActivityLinks } from '../../src/host/memory/thread-intelligence.js'
import { memoryIdForThreadKey } from '../../src/host/memory/projector.js'

const NOW = 100_000_000
const ALPHA = 'workspace:alpha'
const BETA = 'workspace:beta'
const ID = memoryIdForThreadKey(ALPHA)
function item(
  id: string,
  threadKey: string | undefined,
  atMs: number,
  uris: readonly string[] = [],
  app = 'app.code',
): EpisodeSummary {
  return {
    id: EpisodeId(id),
    startedAtMs: atMs,
    endedAtMs: atMs + 60_000,
    boundary: { startReason: 'first-observation', endReason: 'timeout' },
    summaryKind: 'deterministic',
    summary: 'No content must be inferred from this title',
    summaryObservationIds: [1] as ObservationId[],
    ...(threadKey === undefined ? {} : { threadKey }),
    ...(threadKey
      ? { workspace: { title: threadKey === ALPHA ? 'Project A' : 'Project B' } }
      : {}),
    resources: uris.map(uri => ({
      kind: 'file' as const, canonicalUri: uri,
      firstSeenAtMs: atMs, lastSeenAtMs: atMs + 60_000,
      observationCount: 1,
    })),
    surfaces: [{
      bundleId: app, surfaceKind: 'editor' as const,
      firstSeenAtMs: atMs, lastSeenAtMs: atMs + 60_000,
      observationCount: 1,
    }],
    state: 'closed',
    confidence: 0.9,
  }
}

describe('M4 Work Thread Intelligence read-only associations', () => {
  it('connects an unassigned browser and editor by exact complete file identity across time', () => {
    const source = item('source', ALPHA, NOW - 5_000_000, ['file:///a/r1.ts'])
    const browser = item('browser', undefined, NOW - 50_000, ['file:///a/r1.ts'], 'browser')
    const out = buildThreadActivityLinks([source, browser], ID, NOW)
    expect(out.links).toMatchObject([{
      episodeId: 'browser', anchorEpisodeId: 'source',
      kind: 'exact-resource', attribution: 'resource-linked',
      sharedResourceUri: 'file:///a/r1.ts', appBundleIds: ['browser'],
    }])
    expect(JSON.stringify(out)).not.toContain(source.summary)
  })

  it('never uses a shared basename to infer membership', () => {
    const a = item('a', ALPHA, NOW - 500_000, ['file:///p1/README.md'])
    const b = item('b', undefined, NOW - 300_000, ['file:///p2/README.md'])
    expect(buildThreadActivityLinks([a, b], ID, NOW).links).toEqual([])
  })

  it('never uses domain-only URL, app name or window title as identity evidence', () => {
    const a = item('a', ALPHA, NOW - 10_000_000, ['https://github.com/o/p'])
    const b = item('b', undefined, NOW - 9_000_000, ['https://github.com/o/p'])
    expect(buildThreadActivityLinks([a, b], ID, NOW).links).toEqual([])
  })

  it('never merges an Episode with another trusted threadKey', () => {
    const a = item('a', ALPHA, NOW - 10_000, ['file:///common.ts'])
    const b = item('b', BETA, NOW - 10_000, ['file:///common.ts'])
    expect(buildThreadActivityLinks([a, b], ID, NOW).links).toEqual([])
  })

  it('does not attach a shared file when both trusted threads used it', () => {
    const a = item('a', ALPHA, NOW - 10_000_000, ['file:///common.ts'])
    const b = item('b', BETA, NOW - 8_000_000, ['file:///common.ts'])
    const candidate = item('candidate', undefined, NOW - 7_000_000, ['file:///common.ts'])
    expect(buildThreadActivityLinks([a, b, candidate], ID, NOW).links).toEqual([])
  })

  it('shows temporal neighbor as explicitly unattributed, never a strong link', () => {
    const a = item('a', ALPHA, NOW - 300_000)
    const b = item('b', undefined, NOW - 260_000, [], 'terminal')
    expect(buildThreadActivityLinks([a, b], ID, NOW).links).toMatchObject([{
      episodeId: 'b', kind: 'nearby-unassigned',
      attribution: 'unattributed', appBundleIds: ['terminal'],
    }])
    expect(buildThreadActivityLinks([a, b], ID, NOW).links[0]?.sharedResourceUri)
      .toBeUndefined()
  })

  it('suppresses temporal proximity when multiple trusted projects are active', () => {
    const a = item('a', ALPHA, NOW - 300_000)
    const b = item('b', BETA, NOW - 320_000)
    const unrelated = item('u', undefined, NOW - 280_000)
    expect(buildThreadActivityLinks([a, b, unrelated], ID, NOW).links).toEqual([])
  })

  it('refuses faraway temporal coincidences', () => {
    const a = item('a', ALPHA, NOW - 5_000_000)
    const b = item('b', undefined, NOW - 3_000_000)
    expect(buildThreadActivityLinks([a, b], ID, NOW).links).toEqual([])
  })

  it('excludes invalidated Episodes and obeys source deletion immediately', () => {
    const a = item('a', ALPHA, NOW - 5_000_000, ['file:///same'])
    const b = item('b', undefined, NOW - 500_000, ['file:///same'])
    expect(buildThreadActivityLinks([a, b], ID, NOW).links).toHaveLength(1)
    expect(buildThreadActivityLinks([a], ID, NOW).links).toEqual([])
    expect(buildThreadActivityLinks([a, { ...b, state: 'invalidated' }], ID, NOW).links)
      .toEqual([])
    expect(buildThreadActivityLinks([b], ID, NOW).links).toEqual([])
  })

  it('is independent of the input ordering', () => {
    const a = item('a', ALPHA, NOW - 1_000_000, ['file:///shared'])
    const b = item('b', undefined, NOW - 100_000, ['file:///shared'])
    const c = item('c', undefined, NOW - 120_000)
    expect(buildThreadActivityLinks([a, b, c], ID, NOW))
      .toEqual(buildThreadActivityLinks([c, b, a], ID, NOW))
  })

  it('never derives current task completion or mutates existing thread assignments', () => {
    const source = item('source', ALPHA, NOW - 500_000)
    const candidate = item('candidate', undefined, NOW - 450_000)
    buildThreadActivityLinks([source, candidate], ID, NOW)
    expect(candidate.threadKey).toBeUndefined()
    expect(source.threadKey).toBe(ALPHA)
  })

  it('downgrades provenance after raw citations expire', () => {
    const a = item('a', ALPHA, NOW - 3_000_000, ['file:///x'])
    const b = { ...item('b', undefined, NOW - 10_000, ['file:///x']),
      summaryObservationIds: [] }
    expect(buildThreadActivityLinks([a, b], ID, NOW).links[0]?.sourceEvidence)
      .toBe('episode-compacted')
  })

  it('limits returned links and makes truncation explicit', () => {
    const a = item('a', ALPHA, NOW - 5_000_000, ['file:///x'])
    const rest = Array.from({ length: 22 }, (_, i) =>
      item('b' + i, undefined, NOW - (i + 1) * 60_000, ['file:///x']))
    const out = buildThreadActivityLinks([a, ...rest], ID, NOW)
    expect(out.links).toHaveLength(20)
    expect(out.scanTruncated).toBe(true)
    expect(out.scannedEpisodes).toBe(23)
  })

  it('requires a real project id, rather than a fuzzy project name', () => {
    expect(() => buildThreadActivityLinks([], 'Project A', NOW)).toThrow(/invalid/)
  })
})
