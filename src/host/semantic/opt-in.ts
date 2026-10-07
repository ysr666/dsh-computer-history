import type { DatabaseSync } from 'node:sqlite'
import { EpisodeId, type EpisodeId as EpisodeIdType } from '../../shared/index.js'
import {
  scopeKey as toScopeKey,
  SummaryProviderError,
  type SummaryProviderKind,
  type SummaryScope,
} from './provider.js'

export interface SemanticOptIn {
  readonly scopeKey: string
  readonly providerKind: 'local' | 'remote'
  readonly model?: string
  readonly createdAtMs: number
}

export class SemanticOptInStore {
  public constructor(private readonly db: DatabaseSync) {}

  public list(): readonly SemanticOptIn[] {
    return (
      this.db.prepare(`
        SELECT scope_key, provider_kind, model, created_at_ms
        FROM semantic_opt_ins
        ORDER BY created_at_ms
      `).all() as Array<{
        scope_key: string
        provider_kind: string
        model: string | null
        created_at_ms: number
      }>
    ).map((row): SemanticOptIn => {
      // Built without a spread: oxlint flags spreading inside `map`, and an
      // explicit branch says the same thing without the allocation.
      if (row.model === null) {
        return {
          scopeKey: row.scope_key,
          providerKind: row.provider_kind === 'remote' ? 'remote' : 'local',
          createdAtMs: Number(row.created_at_ms),
        }
      }
      return {
        scopeKey: row.scope_key,
        providerKind: row.provider_kind === 'remote' ? 'remote' : 'local',
        model: row.model,
        createdAtMs: Number(row.created_at_ms),
      }
    })
  }

  public get(scope: SummaryScope): SemanticOptIn | undefined {
    return this.list().find(entry => entry.scopeKey === toScopeKey(scope))
  }

  public grant(
    scope: SummaryScope,
    providerKind: 'local' | 'remote',
    model: string | undefined,
    nowMs: number,
  ): SemanticOptIn {
    this.db.prepare(`
      INSERT INTO semantic_opt_ins(scope_key, provider_kind, model, created_at_ms)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scope_key) DO UPDATE SET
        provider_kind = excluded.provider_kind,
        model = excluded.model,
        created_at_ms = excluded.created_at_ms
    `).run(toScopeKey(scope), providerKind, model ?? null, nowMs)
    return this.get(scope) as SemanticOptIn
  }

  /**
   * Identify model-written Episode summaries for one scope.
   *
   * "Turn off and purge" removes the model output, not the underlying work
   * history. The backend owns the EpisodeStore and can therefore replace each
   * model summary with a freshly rendered deterministic summary while keeping
   * workspace/resource/surface/provenance rows intact.
   */
  public modelEpisodeIds(scope: SummaryScope): readonly EpisodeIdType[] {
    const rows = scope.kind === 'workspace'
      ? this.db.prepare(`
          SELECT id
          FROM episodes
          WHERE summary_kind <> 'deterministic'
            AND primary_workspace_id = ?
          ORDER BY id
        `).all(scope.id)
      : this.db.prepare(`
          SELECT e.id
          FROM episodes e
          WHERE e.summary_kind <> 'deterministic'
            AND EXISTS (
              SELECT 1
              FROM episode_surfaces es
              WHERE es.episode_id = e.id
                AND es.bundle_id = ?
            )
          ORDER BY e.id
        `).all(scope.bundleId)

    return (rows as Array<{ id: string }>).map(row => EpisodeId(row.id))
  }

  /** "Turn off and purge": the record goes, and the caller deletes derived text. */
  public revoke(scope: SummaryScope): boolean {
    const result = this.db.prepare(
      'DELETE FROM semantic_opt_ins WHERE scope_key = ?',
    ).run(toScopeKey(scope))
    return Number(result.changes) > 0
  }
}

/**
 * The one gate a non-loopback provider must pass. Kept next to the opt-in store
 * so the guard script can insist that any code which can reach the network
 * calls it.
 */
export function assertRemoteOptIn(
  store: SemanticOptInStore,
  scope: SummaryScope,
): void {
  const record = store.get(scope)
  if (!record || record.providerKind !== 'remote') {
    throw new SummaryProviderError(
      `no recorded opt-in for ${toScopeKey(scope)}: remote summaries are off by default`,
    )
  }
}

export function parseScopeKey(scopeKey: string): SummaryScope {
  const [kind, ...rest] = scopeKey.split(':')
  const id = rest.join(':')
  if (kind === 'workspace' && id.length > 0) return { kind: 'workspace', id }
  if (kind === 'app' && id.length > 0) return { kind: 'app', bundleId: id }
  throw new SummaryProviderError(`unrecognised scope key: ${scopeKey}`)
}

export function providerKindAllowed(
  store: SemanticOptInStore,
  scope: SummaryScope,
  kind: SummaryProviderKind,
): boolean {
  if (kind !== 'remote') return true
  try {
    assertRemoteOptIn(store, scope)
    return true
  } catch {
    return false
  }
}
