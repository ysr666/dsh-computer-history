import type { DatabaseSync } from 'node:sqlite'
import {
  EPISODE_RETENTION_MS,
  OBSERVATION_RETENTION_MS,
  RETENTION_BOUNDS,
  type RetentionSettings,
} from '../../shared/index.js'

export const DEFAULT_RETENTION: RetentionSettings = {
  observationRetentionHours: OBSERVATION_RETENTION_MS / 3_600_000,
  episodeRetentionDays: EPISODE_RETENTION_MS / 86_400_000,
  updatedAtMs: 0,
}

export class RetentionSettingsError extends Error {}

/**
 * The user's retention choice, or the built-in default when they have not made
 * one. Absence of a row means "unchanged", never "zero".
 */
export class RetentionSettingsStore {
  public constructor(private readonly db: DatabaseSync) {}

  public get(): RetentionSettings {
    const row = this.db.prepare(`
      SELECT observation_retention_hours, episode_retention_days, updated_at_ms
      FROM retention_settings WHERE singleton = 1
    `).get() as {
      observation_retention_hours: number
      episode_retention_days: number
      updated_at_ms: number
    } | undefined
    if (!row) return DEFAULT_RETENTION
    return {
      observationRetentionHours: Number(row.observation_retention_hours),
      episodeRetentionDays: Number(row.episode_retention_days),
      updatedAtMs: Number(row.updated_at_ms),
    }
  }

  public set(
    input: {
      readonly observationRetentionHours: number
      readonly episodeRetentionDays: number
    },
    nowMs: number,
  ): RetentionSettings {
    for (const [key, bounds] of Object.entries(RETENTION_BOUNDS)) {
      const value = input[key as keyof typeof RETENTION_BOUNDS]
      if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
        throw new RetentionSettingsError(
          `${key} must be a whole number between ${bounds.min} and ${bounds.max}`,
        )
      }
    }
    this.db.prepare(`
      INSERT INTO retention_settings(
        singleton, observation_retention_hours, episode_retention_days, updated_at_ms
      ) VALUES (1, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET
        observation_retention_hours = excluded.observation_retention_hours,
        episode_retention_days = excluded.episode_retention_days,
        updated_at_ms = excluded.updated_at_ms
    `).run(
      input.observationRetentionHours,
      input.episodeRetentionDays,
      nowMs,
    )
    return this.get()
  }

  /** The observation TTL to stamp on what is recorded from now on. */
  public observationRetentionMs(): number {
    return this.get().observationRetentionHours * 3_600_000
  }

  /** The Episode TTL to stamp on summaries recorded from now on. */
  public episodeRetentionMs(): number {
    return this.get().episodeRetentionDays * 86_400_000
  }
}
