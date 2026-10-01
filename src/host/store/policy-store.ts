import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import {
  PolicyRuleId,
  type PolicyAction,
  type PolicyDimension,
  type PolicyMatcher,
  type PolicyMode,
  type PolicyRule,
  type PolicySnapshot,
} from '../../shared/index.js'

function requiredString(
  row: Record<string, SQLOutputValue>,
  key: string,
): string {
  const value = row[key]
  if (typeof value !== 'string') {
    throw new Error(`invalid policy row: ${key} must be a string`)
  }
  return value
}

function requiredNumber(
  row: Record<string, SQLOutputValue>,
  key: string,
): number {
  const value = row[key]
  if (typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error(`invalid policy row: ${key} must be numeric`)
  }
  return Number(value)
}

function policyMode(value: string): PolicyMode {
  if (value === 'include-only' || value === 'exclude') return value
  throw new Error(`invalid policy mode: ${value}`)
}

function policyDimension(value: string): PolicyDimension {
  if (value === 'app' || value === 'resource') return value
  throw new Error(`invalid policy dimension: ${value}`)
}

function policyAction(value: string): PolicyAction {
  if (value === 'allow' || value === 'deny' || value === 'protect') return value
  throw new Error(`invalid policy action: ${value}`)
}

function policyMatcher(value: string): PolicyMatcher {
  if (value === 'exact' || value === 'prefix' || value === 'glob') return value
  throw new Error(`invalid policy matcher: ${value}`)
}

export class PolicyStore {
  public constructor(private readonly db: DatabaseSync) {}

  public ensureInitial(nowMs: number): PolicySnapshot {
    this.db.prepare(`
      INSERT OR IGNORE INTO policy_state(
        singleton, revision, mode, updated_at_ms
      ) VALUES (1, 1, 'include-only', ?)
    `).run(nowMs)
    return this.get()
  }

  public get(): PolicySnapshot {
    const state = this.db.prepare(`
      SELECT revision, mode, updated_at_ms
      FROM policy_state
      WHERE singleton = 1
    `).get()

    if (!state) throw new Error('policy state is not initialized')

    const rules = this.db.prepare(`
      SELECT
        id, dimension, action, matcher, pattern,
        built_in, created_at_ms, updated_at_ms
      FROM policy_rules
      ORDER BY built_in DESC, id
    `).all()

    return {
      revision: requiredNumber(state, 'revision'),
      mode: policyMode(requiredString(state, 'mode')),
      updatedAtMs: requiredNumber(state, 'updated_at_ms'),
      rules: rules.map((row) => ({
        id: PolicyRuleId(requiredString(row, 'id')),
        dimension: policyDimension(requiredString(row, 'dimension')),
        action: policyAction(requiredString(row, 'action')),
        matcher: policyMatcher(requiredString(row, 'matcher')),
        pattern: requiredString(row, 'pattern'),
        builtIn: requiredNumber(row, 'built_in') === 1,
        createdAtMs: requiredNumber(row, 'created_at_ms'),
        updatedAtMs: requiredNumber(row, 'updated_at_ms'),
      })),
    }
  }

  public replace(
    mode: PolicySnapshot['mode'],
    rules: readonly PolicyRule[],
    nowMs: number,
  ): PolicySnapshot {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const current = this.get()
      const revision = current.revision + 1

      this.db.prepare('DELETE FROM policy_rules WHERE built_in = 0').run()
      const insert = this.db.prepare(`
        INSERT INTO policy_rules(
          id, dimension, action, matcher, pattern,
          built_in, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (const rule of rules.filter((item) => !item.builtIn)) {
        insert.run(
          rule.id,
          rule.dimension,
          rule.action,
          rule.matcher,
          rule.pattern,
          0,
          rule.createdAtMs,
          nowMs,
        )
      }

      this.db.prepare(`
        UPDATE policy_state
        SET revision = ?, mode = ?, updated_at_ms = ?
        WHERE singleton = 1
      `).run(revision, mode, nowMs)

      this.db.exec('COMMIT')
      return this.get()
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
