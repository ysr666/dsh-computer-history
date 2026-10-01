import type { DatabaseSync } from 'node:sqlite'

export function inTransaction<T>(
  db: DatabaseSync,
  action: () => T,
): T {
  if (db.isTransaction) return action()

  db.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
