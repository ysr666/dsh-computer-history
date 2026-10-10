import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import type { EpisodeResourceSummary, EpisodeSurfaceSummary } from '../../shared/index.js'
import { renderDeterministicSummary } from './summary.js'

/** Rebuild only browser-associated Episode summaries from safe structural evidence. */
export function rederiveBrowserEpisodeSummaries(
  db: DatabaseSync,
  onlyEpisodeIds?: ReadonlySet<string>,
): void {
  const affected = db.prepare(`
    SELECT DISTINCT e.id, e.primary_workspace_title
    FROM episodes e
    WHERE EXISTS (
      SELECT 1 FROM episode_resources er
      JOIN resources r ON r.id = er.resource_id
      WHERE er.episode_id = e.id AND r.kind = 'url'
    ) OR EXISTS (
      SELECT 1 FROM episode_surfaces es
      WHERE es.episode_id = e.id AND es.surface_kind = 'browser'
    ) OR EXISTS (
      SELECT 1 FROM episode_observations eo
      JOIN observations o ON o.id = eo.observation_id
      WHERE eo.episode_id = e.id AND (
        o.surface_kind = 'browser' OR o.source_adapter = 'browser'
      )
    )
  `).all() as Array<Record<string, SQLOutputValue>>

  const resourceRows = db.prepare(`
    SELECT r.kind, r.canonical_uri, er.first_seen_at_ms,
      er.last_seen_at_ms, er.observation_count
    FROM episode_resources er
    JOIN resources r ON r.id = er.resource_id
    WHERE er.episode_id = ?
    ORDER BY er.first_seen_at_ms, r.id
  `)
  const surfaceRows = db.prepare(`
    SELECT bundle_id, surface_kind, first_seen_at_ms,
      last_seen_at_ms, observation_count
    FROM episode_surfaces WHERE episode_id = ?
    ORDER BY first_seen_at_ms, bundle_id, surface_kind
  `)
  const updateSummary = db.prepare(`
    UPDATE episodes SET summary_text = ?, summary_kind = 'deterministic'
    WHERE id = ?
  `)

  for (const episode of affected) {
    const id = String(episode.id)
    if (onlyEpisodeIds && !onlyEpisodeIds.has(id)) continue
    const resources = resourceRows.all(id).map(row => ({
      kind: String(row.kind) as EpisodeResourceSummary['kind'],
      canonicalUri: String(row.canonical_uri),
      firstSeenAtMs: Number(row.first_seen_at_ms),
      lastSeenAtMs: Number(row.last_seen_at_ms),
      observationCount: Number(row.observation_count),
    }))
    const surfaces = surfaceRows.all(id).map(row => ({
      bundleId: String(row.bundle_id),
      surfaceKind: String(row.surface_kind) as EpisodeSurfaceSummary['surfaceKind'],
      firstSeenAtMs: Number(row.first_seen_at_ms),
      lastSeenAtMs: Number(row.last_seen_at_ms),
      observationCount: Number(row.observation_count),
    }))
    const summary = renderDeterministicSummary({
      ...(typeof episode.primary_workspace_title === 'string'
        ? { workspaceTitle: episode.primary_workspace_title } : {}),
      resources, surfaces,
    })
    updateSummary.run(summary, id)
  }
}
