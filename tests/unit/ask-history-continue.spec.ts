import { describe, expect, it, vi } from 'vitest'
import type { EpisodeDetail, HistorySearchHit } from '../../src/shared/index.js'
import { continueFromHistoryHit } from '../../src/client/ask-history-view.js'

const hit = {
  id: 'ah_one', kind: 'file', title: 'model.sldprt',
  episodeId: 'episode:cad-1', observedAtMs: 123,
  evidenceLevel: 'episode-compacted',
  provenance: 'Recorded metadata',
} as HistorySearchHit
const episode = {
  id: 'episode:cad-1', state: 'closed', startedAtMs: 100,
  endedAtMs: 123, summary: 'CAD metadata',
  workspace: { id: 'cad-workspace', title: 'MechanicalDesign' },
  resources: [], surfaces: [], summaryObservationIds: [],
} as unknown as EpisodeDetail

describe('Ask Your History → exact Continue handoff', () => {
  it('continues only the exact source Episode chosen by the user', async () => {
    const getEpisode = vi.fn().mockResolvedValue(episode)
    const continueEpisode = vi.fn().mockResolvedValue(undefined)
    await continueFromHistoryHit(hit, getEpisode, continueEpisode)
    expect(getEpisode).toHaveBeenCalledExactlyOnceWith('episode:cad-1')
    expect(continueEpisode).toHaveBeenCalledExactlyOnceWith(episode)
  })

  it('never chooses another Episode if the target ID differs', async () => {
    const continueEpisode = vi.fn()
    await expect(continueFromHistoryHit(
      hit,
      async () => ({ ...episode, id: 'episode:unrelated' } as EpisodeDetail),
      continueEpisode,
    )).rejects.toThrow(/unavailable/)
    expect(continueEpisode).not.toHaveBeenCalled()
  })

  it('refuses an invalidated, deleted, or missing Episode', async () => {
    const continueEpisode = vi.fn()
    await expect(continueFromHistoryHit(
      hit, async () => ({ ...episode, state: 'invalidated' }), continueEpisode,
    )).rejects.toThrow(/unavailable/)
    await expect(continueFromHistoryHit(
      hit, async () => undefined as never, continueEpisode,
    )).rejects.toThrow(/unavailable/)
    expect(continueEpisode).not.toHaveBeenCalled()
  })

  it('propagates the Host/Continue binding rejection for an expired Episode', async () => {
    const continueEpisode = vi.fn().mockRejectedValue(new Error('source-not-retained'))
    await expect(continueFromHistoryHit(
      hit, async () => episode, continueEpisode,
    )).rejects.toThrow(/source-not-retained/)
    expect(continueEpisode).toHaveBeenCalledTimes(1)
  })
})
