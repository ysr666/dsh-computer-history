import type { DatabaseSync } from 'node:sqlite'

/**
 * Pairing material for the browser companion (ADR 0007).
 *
 * Only a hash of the token is stored: the token itself is shown once in the
 * panel and never persisted, so a leaked database does not hand an attacker a
 * working credential. The single-row shape is enforced by the primary key.
 */
export const migration0002 = {
  version: 2,
  name: 'companion-pairing',
  checksum: '2026-10-02-companion-pairing-v1',

  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE companion_pairing (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        token_hash TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
    `)
  },
}
