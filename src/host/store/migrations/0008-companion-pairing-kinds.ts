import type { DatabaseSync } from 'node:sqlite'

/**
 * Browser and editor companions must not invalidate each other's credentials.
 *
 * Version 2 had one singleton token because the browser was the only companion.
 * The editor companion made that shape unsafe for productized pairing: rotating a
 * browser token would silently disconnect the editor, and vice versa. Preserve the
 * existing credential as the browser credential and move to one digest per kind.
 */
export const migration0008 = {
  version: 8,
  name: 'companion-pairing-kinds',
  checksum: '2026-10-04-companion-pairing-kinds-v1',
  // This replaces the singleton table in place. There are no current foreign
  // keys to it, but any DROP/RENAME migration must still use the guarded rebuild
  // path so the runner performs its post-migration foreign_key_check.
  rebuildsReferencedTable: true,

  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE companion_pairing_v2 (
        kind TEXT PRIMARY KEY CHECK (kind IN ('browser','editor')),
        token_hash TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );

      INSERT INTO companion_pairing_v2(kind, token_hash, created_at_ms)
      SELECT 'browser', token_hash, created_at_ms
      FROM companion_pairing
      WHERE id = 1;

      DROP TABLE companion_pairing;
      ALTER TABLE companion_pairing_v2 RENAME TO companion_pairing;
    `)
  },
}
