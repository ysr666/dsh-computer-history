import type { DatabaseSync } from 'node:sqlite'

/**
 * Per-scope semantic opt-ins (ADR 0004 §4).
 *
 * This is policy state: a remote summary may only be produced for a scope the
 * user has explicitly enabled, and the record lives here rather than in a
 * configuration file a later default could quietly flip. A `local` row is
 * optional — a local provider needs no consent to keep the data on the machine
 * (§3) — but it is still recorded when a scope is switched on, so the panel can
 * show who produces what.
 */
export const migration0004 = {
  version: 4,
  name: 'semantic-opt-ins',
  checksum: '2026-10-02-semantic-opt-ins-v1',

  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE semantic_opt_ins (
        scope_key TEXT PRIMARY KEY,
        provider_kind TEXT NOT NULL CHECK (provider_kind IN ('local','remote')),
        model TEXT,
        created_at_ms INTEGER NOT NULL
      );
    `)
  },
}
