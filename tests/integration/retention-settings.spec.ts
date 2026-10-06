import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EPISODE_RETENTION_MS,
  OBSERVATION_RETENTION_MS,
  PolicyRuleId,
  type NativeObservation,
  type PolicySnapshot,
} from '../../src/shared/index.js'
import { IngestionService } from '../../src/host/ingestion/index.js'
import {
  DEFAULT_RETENTION,
  RetentionSettingsError,
  RetentionSettingsStore,
} from '../../src/host/store/retention-settings.js'
import { openHistoryDatabase } from '../../src/host/store/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function store() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-retention-'))
  roots.push(root)
  const history = openHistoryDatabase({
    dataDirectory: path.join(root, 'history'),
    nowMs: 1,
  })
  return { history, settings: new RetentionSettingsStore(history.db) }
}

describe('retention settings', () => {
  it('answers with the built-in default until the user chooses', () => {
    const { history, settings } = store()
    expect(settings.get()).toEqual(DEFAULT_RETENTION)
    history.close()
  })

  it('remembers a choice and survives being set twice', () => {
    const { history, settings } = store()
    settings.set({ observationRetentionHours: 6, episodeRetentionDays: 14 }, 100)
    expect(settings.get()).toMatchObject({
      observationRetentionHours: 6,
      episodeRetentionDays: 14,
      updatedAtMs: 100,
    })
    settings.set({ observationRetentionHours: 48, episodeRetentionDays: 7 }, 200)
    expect(settings.get()).toMatchObject({
      observationRetentionHours: 48,
      episodeRetentionDays: 7,
      updatedAtMs: 200,
    })
    history.close()
  })

  it('refuses a window it cannot honour', () => {
    const { history, settings } = store()
    for (const bad of [
      { observationRetentionHours: 0, episodeRetentionDays: 30 },
      { observationRetentionHours: 721, episodeRetentionDays: 30 },
      { observationRetentionHours: 24, episodeRetentionDays: 0 },
      { observationRetentionHours: 24, episodeRetentionDays: 366 },
      { observationRetentionHours: 1.5, episodeRetentionDays: 30 },
    ]) {
      expect(() => settings.set(bad, 1)).toThrow(RetentionSettingsError)
    }
    expect(settings.get()).toEqual(DEFAULT_RETENTION)
    history.close()
  })

  it('stamps the chosen window on what is recorded next', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-retention-ingest-'))
    roots.push(root)
    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
      nowMs: 1,
    })
    const now = Date.now()
    const policy: PolicySnapshot = {
      revision: 1,
      mode: 'include-only',
      updatedAtMs: 1,
      rules: [{
        id: PolicyRuleId('allow-vscode'),
        dimension: 'app',
        action: 'allow',
        matcher: 'exact',
        pattern: 'com.microsoft.VSCode',
        builtIn: false,
        createdAtMs: 1,
        updatedAtMs: 1,
      }],
    }
    const settings = new RetentionSettingsStore(history.db)
    settings.set({
      observationRetentionHours: 12,
      episodeRetentionDays: 9,
    }, now - 1)
    const twelveHours = 12 * 3_600_000
    const nineDays = 9 * 86_400_000
    const ingestion = new IngestionService(
      history.db,
      { resolve: async () => ({ source: 'none' as const, confidence: 0 }) },
      () => policy,
      () => now,
      () => settings.observationRetentionMs(),
      () => settings.episodeRetentionMs(),
    )
    const message: NativeObservation = {
      v: 1,
      type: 'observation',
      collectorSession: 'retention',
      seq: 1,
      observedAtMs: now,
      app: { pid: 3, bundleId: 'com.microsoft.VSCode' },
      window: { title: 'provider.ts' },
      privacy: { secure: false, protected: false },
      source: { adapter: 'vscode' },
    }
    expect(await ingestion.ingest(message)).toBe(true)

    const row = history.db.prepare(
      'SELECT expires_at_ms FROM observations WHERE collector_session = ?',
    ).get('retention') as { expires_at_ms: number }
    expect(row.expires_at_ms).toBe(now + twelveHours)
    expect(row.expires_at_ms).toBeLessThan(now + OBSERVATION_RETENTION_MS)

    const episode = history.db.prepare(
      'SELECT ended_at_ms, expires_at_ms FROM episodes LIMIT 1',
    ).get() as { ended_at_ms: number; expires_at_ms: number }
    expect(episode.expires_at_ms).toBe(episode.ended_at_ms + nineDays)
    expect(episode.expires_at_ms).toBeLessThan(
      episode.ended_at_ms + EPISODE_RETENTION_MS,
    )
    history.close()
  })
})
