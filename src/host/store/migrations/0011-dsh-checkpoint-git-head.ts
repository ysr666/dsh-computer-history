import type { DatabaseSync } from 'node:sqlite'

/** Optional HEAD baseline for comparing a later external-work handoff. */
export const migration0011 = {
  version: 11,
  name: 'dsh-checkpoint-git-head',
  checksum: '2026-10-06-dsh-checkpoint-git-head-v1',

  up(db: DatabaseSync): void {
    db.exec(`
      ALTER TABLE dsh_checkpoints
      ADD COLUMN git_head TEXT;
    `)
  },
} as const
