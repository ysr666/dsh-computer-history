import type { EpisodeSummary, MemoryEvidenceLevel } from '../../shared/index.js'

/**
 * Raw observation TTL is shorter than Episode TTL. The stored Episode can
 * support a compacted locator even when its observation rows have expired.
 */
export function episodeEvidenceLevel(episode: EpisodeSummary): MemoryEvidenceLevel {
  return episode.summaryObservationIds.length > 0
    ? 'observation-backed'
    : 'episode-compacted'
}

export function memoryEvidenceLevel(episodes: readonly EpisodeSummary[]): MemoryEvidenceLevel {
  return episodes.every(e => episodeEvidenceLevel(e) === 'observation-backed')
    ? 'observation-backed'
    : 'episode-compacted'
}
