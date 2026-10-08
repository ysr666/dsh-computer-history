import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { companionObservation } from '../../src/host/companion/observation.js'
import {
  IngestionService,
  normalizeObservation,
} from '../../src/host/ingestion/index.js'
import {
  EpisodeStore,
  ObservationStore,
  openHistoryDatabase,
} from '../../src/host/store/index.js'
import { buildResumeHandoff, resolveResume } from '../../src/host/resume/index.js'
import { PolicyRuleId, type ActivityEventKind, type PolicySnapshot } from '../../src/shared/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

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

describe('editor save continuity', () => {
  it('does not trust a native collector that claims a save event', () => {
    const now = Date.now()
    const observation = normalizeObservation({
      v: 1,
      type: 'observation',
      collectorSession: 'native-spoof',
      seq: 1,
      observedAtMs: now,
      app: { pid: 1, bundleId: 'com.microsoft.VSCode', name: 'Visual Studio Code' },
      window: { document: '/tmp/repo/main.ts' },
      activity: { event: 'save' },
      privacy: { secure: false, protected: false },
      source: { provider: 'macos-ax', adapter: 'vscode' },
    }, policy, now, { source: 'none', confidence: 0 })

    expect(observation?.activity.event).toBeUndefined()
  })

  it('turns an editor save into auditable changedResources and a resume handoff', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-save-'))
    roots.push(root)
    const workspace = path.join(root, 'repo')
    const src = path.join(workspace, 'src')
    mkdirSync(src, { recursive: true })
    const file = path.join(src, 'main.ts')
    writeFileSync(file, 'export {}\n')

    const history = openHistoryDatabase({ dataDirectory: path.join(root, 'history') })
    const now = Date.now()
    const ingestion = new IngestionService(
      history.db,
      { resolve: async () => ({ source: 'none' as const, confidence: 0 }) },
      () => policy,
      () => now + 60_000,
    )

    const report = (seq: number, event?: ActivityEventKind) => companionObservation({
      source: 'editor',
      app: { bundleId: 'com.microsoft.VSCode', name: 'Visual Studio Code' },
      workspaceRoot: workspace,
      filePath: file,
      languageId: 'typescript',
      surfaceKind: 'editor',
      title: 'main.ts',
      ...(event === undefined ? {} : { event }),
      editorSession: 'editor-save',
      seq,
      observedAtMs: now + seq * 1_000,
    })

    expect(await ingestion.ingest(report(1))).toBe(true)
    expect(await ingestion.ingest(report(2, 'save'))).toBe(true)
    expect(await ingestion.ingest(report(3, 'verify-test-success'))).toBe(true)

    const observations = new ObservationStore(history.db).listAll()
    expect(observations.map(item => item.activity.event)).toEqual([
      undefined, 'save', 'verify-test-success',
    ])

    const episodes = new EpisodeStore(history.db).listRecent({ limit: 10 })
    expect(episodes).toHaveLength(1)
    expect(episodes[0]?.changedResources).toEqual([{
      kind: 'file',
      canonicalUri: expect.stringMatching(/main\.ts$/),
      displayLabel: 'main.ts',
      lastChangedAtMs: now + 2_000,
      changeCount: 1,
    }])
    expect(episodes[0]?.verifications).toEqual([{
      kind: 'test',
      result: 'success',
      lastObservedAtMs: now + 3_000,
      observationCount: 1,
    }])

    const resolution = resolveResume(episodes, {
      query: '继续 main.ts',
      nowMs: now + 3_000,
      turn: 1,
      source: 'tool',
    })
    const handoff = buildResumeHandoff(resolution)
    expect(handoff.status).toBe('hit')
    if (handoff.status !== 'hit') throw new Error('expected hit')
    expect(handoff.changedResources.map(resource => resource.displayLabel))
      .toEqual(['main.ts'])
    expect(handoff.verifications).toEqual([{
      kind: 'test',
      result: 'success',
      lastObservedAtMs: now + 3_000,
      observationCount: 1,
    }])

    history.close()
  })
})
