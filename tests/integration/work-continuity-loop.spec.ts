import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAgentResumeHandoff } from '../../src/agent/handoff.js'
import { renderResumeHandoffContext } from '../../src/agent/resume-hint.js'
import { companionObservation } from '../../src/host/companion/observation.js'
import { IngestionService } from '../../src/host/ingestion/index.js'
import { resolveResume } from '../../src/host/resume/index.js'
import {
  DshCheckpointStore,
  EpisodeStore,
  openHistoryDatabase,
} from '../../src/host/store/index.js'
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

function git(workspace: string, ...args: string[]): string {
  return execFileSync('git', ['-C', workspace, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

describe('work continuity loop', () => {
  it('links a DSH checkpoint to real editor saves and current Git state in one handoff', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-continuity-'))
    roots.push(root)
    const workspace = path.join(root, 'demo')
    const src = path.join(workspace, 'src')
    mkdirSync(src, { recursive: true })
    const file = path.join(src, 'main.ts')
    writeFileSync(file, 'export const value = 1\n')

    execFileSync('git', ['init', '-b', 'main', workspace], { stdio: 'ignore' })
    git(workspace, 'config', 'user.email', 'continuity@example.invalid')
    git(workspace, 'config', 'user.name', 'Continuity Test')
    git(workspace, 'add', 'src/main.ts')
    git(workspace, 'commit', '-m', 'fixture')
    const checkpointHead = git(workspace, 'rev-parse', '--verify', 'HEAD').trim()

    const history = openHistoryDatabase({ dataDirectory: path.join(root, 'history') })
    const checkpointStore = new DshCheckpointStore(history.db)
    const now = Date.now()
    checkpointStore.upsert({
      sessionId: 'session-before-external-work',
      turn: 7,
      checkpointAtMs: now,
      cwd: workspace,
      workspace: { root: workspace, title: 'demo' },
      gitHead: checkpointHead,
    }, now + 86_400_000)

    const ingestion = new IngestionService(
      history.db,
      { resolve: async () => ({ source: 'none' as const, confidence: 0 }) },
      () => policy,
      () => now + 86_400_000,
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
      editorSession: 'continuity-editor',
      seq,
      observedAtMs: now + seq * 1_000,
    })

    expect(await ingestion.ingest(report(1))).toBe(true)
    writeFileSync(file, 'export const value = 2\n')
    expect(await ingestion.ingest(report(2, 'save'))).toBe(true)
    expect(await ingestion.ingest(report(3, 'verify-test-success'))).toBe(true)

    // External work can both advance repository history and leave fresh local
    // edits afterward. The handoff must keep those as distinct facts.
    git(workspace, 'add', 'src/main.ts')
    git(workspace, 'commit', '-m', 'external work')
    const currentHead = git(workspace, 'rev-parse', '--verify', 'HEAD').trim()
    expect(currentHead).not.toBe(checkpointHead)
    writeFileSync(file, 'export const value = 3\n')

    const episodes = new EpisodeStore(history.db).listRecent({ limit: 10 })
    expect(episodes).toHaveLength(1)
    const resolution = resolveResume(episodes, {
      query: '继续 main.ts',
      nowMs: now + 4_000,
      turn: 8,
      source: 'tool',
    })

    const spawnedArgv: string[][] = []
    const ctx = {
      get(name: string) {
        if (name !== 'computerHistory') return undefined
        return {
          latestDshCheckpoint(request: {
            workspaceId?: string
            workspaceRoot?: string
            atOrBeforeMs: number
          }) {
            return checkpointStore.latestForWorkspace(request)
          },
        }
      },
      subprocess: {
        spawn({ argv, cwd }: { argv: string[], cwd: string }) {
          spawnedArgv.push(argv)
          const output = execFileSync(argv[0]!, argv.slice(1), {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          return {
            done: Promise.resolve({ exitCode: 0, signal: null }),
            collected: {
              stdout: {
                readFrom: () => ({
                  text: output,
                  nextOffset: Buffer.byteLength(output),
                  lossy: false,
                }),
              },
            },
          }
        },
      },
    } as unknown as Context

    const handoff = await buildAgentResumeHandoff(ctx, resolution)
    expect(handoff.status).toBe('hit')
    if (handoff.status !== 'hit') throw new Error('expected hit')

    expect(handoff.workspace?.root).toBe(workspace)
    expect(handoff.lastActiveResource?.displayLabel).toBe('main.ts')
    expect(handoff.changedResources).toEqual([
      expect.objectContaining({ displayLabel: 'main.ts', changeCount: 1 }),
    ])
    expect(handoff.verifications).toEqual([{
      kind: 'test',
      result: 'success',
      lastObservedAtMs: now + 3_000,
      observationCount: 1,
    }])
    expect(handoff.git).toMatchObject({
      branch: 'main',
      head: currentHead,
      dirty: true,
      changedFiles: [{ path: 'src/main.ts', status: '.M' }],
      truncated: false,
    })
    expect(handoff.checkpoint).toMatchObject({
      sessionId: 'session-before-external-work',
      turn: 7,
      gitHead: checkpointHead,
    })
    expect(handoff.git?.head).not.toBe(handoff.checkpoint?.gitHead)
    expect(handoff.evidenceObservationIds.length).toBeGreaterThan(0)
    expect(handoff).not.toHaveProperty('summary')
    expect(spawnedArgv).toHaveLength(1)
    expect(spawnedArgv[0]).toEqual([
      'git', '-C', workspace,
      'status', '--porcelain=v2', '--branch', '--untracked-files=normal',
    ])
    expect(spawnedArgv[0]).not.toContain('diff')

    const modelContext = renderResumeHandoffContext(handoff)
    expect(modelContext).toContain(
      '[observed-save + current-git .M] main.ts',
    )
    expect(modelContext).toContain(
      'Latest observed verification: test success',
    )
    expect(modelContext).toContain(
      'Workspace: demo [' + workspace + ']',
    )
    expect(modelContext).toContain(
      'Repository HEAD differs from the previous DSH boundary',
    )
    expect(modelContext).toContain(
      'Provenance rule: [observed-*] is historical Computer History evidence',
    )
    expect(modelContext).toContain(
      'Authoritative-source cue: this work has a local workspace/file locator.',
    )
    expect(modelContext).toContain(
      'Recovery rule: if authoritative current state disagrees with history metadata, authoritative state wins.',
    )
    expect(modelContext.length).toBeLessThanOrEqual(2_400)

    history.close()
  })
})
