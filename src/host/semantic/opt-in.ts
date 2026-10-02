import type { DatabaseSync } from 'node:sqlite'
import {
  scopeKey,
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
    return this.list().find(entry => entry.scopeKey === scopeKey(scope))
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
    `).run(scopeKey(scope), providerKind, model ?? null, nowMs)
    return this.get(scope) as SemanticOptIn
  }

  /** "Turn off and purge": the record goes, and the caller deletes derived text. */
  public revoke(scope: SummaryScope): boolean {
    const result = this.db.prepare(
      'DELETE FROM semantic_opt_ins WHERE scope_key = ?',
    ).run(scopeKey(scope))
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
      `no recorded opt-in for ${scopeKey(scope)}: remote summaries are off by default`,
    )
  }
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
