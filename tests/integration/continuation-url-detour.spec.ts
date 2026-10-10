import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { companionObservation } from '../../src/host/companion/observation.js'
import { IngestionService } from '../../src/host/ingestion/index.js'
import {
  buildPriorThreadTail,
  buildUrlDetourBridge,
} from '../../src/host/resume/index.js'
import { EpisodeStore, openHistoryDatabase } from '../../src/host/store/index.js'
import {
  COMPANION_BUNDLE_ID,
  PolicyRuleId,
  type PolicySnapshot,
} from '../../src/shared/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const policy: PolicySnapshot = {
  revision: 1,
  mode: 'include-only',
  updatedAtMs: 1,
  rules: [
    {
      id: PolicyRuleId('allow-vscode'),
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: 'com.microsoft.VSCode',
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    },
    {
      id: PolicyRuleId('allow-browser-companion'),
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: COMPANION_BUNDLE_ID,
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    },
  ],
}


function browserCompanion(
  seq: number,
  observedAtMs: number,
) {
  return companionObservation({
    source: 'browser',
    origin: 'https://docs.example',
    path: '/guide',
    title: 'Guide',
    browserSession: 'browser-detour',
    incognito: false,
    seq,
    observedAtMs,
  })
}

describe('explicit Continue URL detour evidence', () => {
  it('keeps a short browser companion detour inside the editor workspace Episode', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-short-detour-'))
    roots.push(root)
    const workspace = path.join(root, 'repo')
    const file = path.join(workspace, 'main.ts')
    mkdirSync(workspace, { recursive: true })
    writeFileSync(file, 'export const value = 1\n')
    const now = 1_000_000

    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
    })
    const ingestion = new IngestionService(
      history.db,
      { resolve: async () => ({ source: 'none' as const, confidence: 0 }) },
      () => policy,
      () => now + 1_000_000,
    )

    const editor = (seq: number, observedAtMs: number) => companionObservation({
      source: 'editor',
      app: {
        bundleId: 'com.microsoft.VSCode',
        name: 'Visual Studio Code',
      },
      workspaceRoot: workspace,
      filePath: file,
      surfaceKind: 'editor',
      title: 'main.ts',
      editorSession: 'editor-short-detour',
      seq,
      observedAtMs,
    })

    expect(await ingestion.ingest(editor(1, now))).toBe(true)
    expect(await ingestion.ingest(browserCompanion(1, now + 10_000))).toBe(true)
    expect(await ingestion.ingest(editor(2, now + 20_000))).toBe(true)

    const episodes = new EpisodeStore(history.db)
      .listRecent({ limit: 10 })
      .toReversed()

    expect(episodes).toHaveLength(1)
    expect(episodes[0]?.workspace?.root).toBe(workspace)
    expect(episodes[0]?.threadKey).toBeTruthy()
    expect(episodes[0]?.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'file',
        canonicalUri: expect.stringContaining('/main.ts'),
      }),
      expect.objectContaining({
        kind: 'url',
        canonicalUri: 'https://docs.example/guide',
        displayLabel: 'docs.example/guide',
      }),
    ]))
    expect(episodes[0]?.surfaces.map(surface => surface.surfaceKind))
      .toEqual(expect.arrayContaining(['editor', 'browser']))
    expect(episodes[0]?.summaryObservationIds).toHaveLength(3)

    history.close()
  })

  it('bridges the real companion collector-switch loop from stored Episode evidence', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-detour-'))
    roots.push(root)
    const workspace = path.join(root, 'repo')
    const file = path.join(workspace, 'main.ts')
    mkdirSync(workspace, { recursive: true })
    writeFileSync(file, 'export const value = 1\n')
    const now = 1_000_000

    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
    })
    const ingestion = new IngestionService(
      history.db,
      { resolve: async () => ({ source: 'none' as const, confidence: 0 }) },
      () => policy,
      () => now + 1_000_000,
    )

    const editor = (seq: number, observedAtMs: number) => companionObservation({
      source: 'editor',
      app: {
        bundleId: 'com.microsoft.VSCode',
        name: 'Visual Studio Code',
      },
      workspaceRoot: workspace,
      filePath: file,
      surfaceKind: 'editor',
      title: 'main.ts',
      editorSession: 'editor-detour',
      seq,
      observedAtMs,
    })
    expect(await ingestion.ingest(editor(1, now))).toBe(true)
    expect(await ingestion.ingest(browserCompanion(1, now + 100_000))).toBe(true)
    expect(await ingestion.ingest(editor(2, now + 200_000))).toBe(true)

    const episodes = new EpisodeStore(history.db)
      .listRecent({ limit: 10 })
      .toReversed()

    expect(episodes).toHaveLength(3)
    const [before, detour, after] = episodes

    expect(before?.boundary).toEqual({
      startReason: 'first-observation',
      endReason: 'workspace-switch',
    })
    expect(detour?.boundary).toEqual({
      startReason: 'workspace-switch',
      endReason: 'workspace-switch',
    })
    expect(after?.boundary).toEqual({
      startReason: 'workspace-switch',
      endReason: 'timeout',
    })

    expect(before?.threadKey).toBe(after?.threadKey)
    expect(before?.threadKey).toBeTruthy()
    expect(detour?.threadKey).toBeUndefined()
    expect(detour?.workspace).toBeUndefined()
    expect(detour?.resources).toEqual([
      expect.objectContaining({
        kind: 'url',
        canonicalUri: 'https://docs.example/guide',
        displayLabel: 'docs.example/guide',
      }),
    ])
    expect(detour?.surfaces.map(surface => surface.surfaceKind))
      .toEqual(['browser'])

    const threadEpisodes = [before!, after!]
    const priorTail = buildPriorThreadTail(threadEpisodes, after!.id)
    expect(priorTail?.episodeIds).toEqual([before!.id])

    const bridge = buildUrlDetourBridge(
      threadEpisodes,
      episodes,
      after!.id,
    )
    expect(bridge).toMatchObject({
      episodeId: detour!.id,
      referenceResources: [{
        kind: 'url',
        canonicalUri: 'https://docs.example/guide',
        displayLabel: 'docs.example/guide',
      }],
    })
    expect(bridge?.evidenceObservationIds.length).toBeGreaterThan(0)

    history.close()
  })
})
