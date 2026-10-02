import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PolicyRuleId,
  type PolicySnapshot,
  type NativeObservation,
} from '../../src/shared/index.js'
import { IngestionService } from '../../src/host/ingestion/index.js'
import { ObservationStore, openHistoryDatabase } from '../../src/host/store/index.js'
import { EpisodeStore } from '../../src/host/store/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function workspaceOnDisk(): { root: string, file: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-vouched-'))
  roots.push(root)
  mkdirSync(path.join(root, 'src'), { recursive: true })
  const file = path.join(root, 'src', 'main.ts')
  writeFileSync(file, 'export {}\n')
  return { root, file }
}

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

function service(
  root: string,
  options: { extraRules?: readonly PolicySnapshot['rules'][number][] } = {},
) {
  const history = openHistoryDatabase({
    dataDirectory: path.join(root, 'history'),
    nowMs: 1,
  })
  const now = Date.now()
  return {
    history,
    now,
    ingestion: new IngestionService(
      history.db,
      // The resolver always has an opinion; the question is whether it is
      // allowed to override a vouch.
      { resolve: async () => ({ source: 'filesystem' as const, confidence: 0.4, root: '/inferred' }) },
      () => options.extraRules
        ? { ...policy, rules: [...policy.rules, ...options.extraRules] }
        : policy,
      // A clock ahead of the fixture's timestamps: an observation dated in the
      // future is refused by design, which is not what these cases are about.
      () => now + 60_000,
    ),
  }
}

describe('a vouched workspace (ADR 0009)', () => {
  it('records the companion root as companion provenance', async () => {
    const { root, file } = workspaceOnDisk()
    const { history, ingestion, now } = service(root)
    const message: NativeObservation = {
      v: 1,
      type: 'observation',
      collectorSession: 'editor-live',
      seq: 1,
      observedAtMs: now,
      app: { pid: 0, bundleId: 'com.microsoft.VSCode', name: 'Visual Studio Code' },
      window: { document: file, title: 'main.ts' },
      workspace: { root, title: 'vouched' },
      privacy: { secure: false, protected: false },
      source: { provider: 'companion', adapter: 'vscode' },
    }
    expect(await ingestion.ingest(message)).toBe(true)

    const stored = new ObservationStore(history.db).listAll()[0]!
    expect(stored.workspace).toMatchObject({
      id: root,
      root,
      title: 'vouched',
      source: 'companion',
      confidence: 1,
    })
    history.close()
  })

  it('ignores a workspace claimed through Accessibility', async () => {
    const { root, file } = workspaceOnDisk()
    const { history, ingestion, now } = service(root)
    const message: NativeObservation = {
      v: 1,
      type: 'observation',
      collectorSession: 'ax-live',
      seq: 1,
      observedAtMs: now,
      app: { pid: 9, bundleId: 'com.microsoft.VSCode' },
      window: { document: file, title: 'main.ts' },
      // An Accessibility observation cannot vouch for anything; this field is
      // honoured only from a paired companion.
      workspace: { root, title: 'not a vouch' },
      privacy: { secure: false, protected: false },
      source: { provider: 'macos-ax', adapter: 'vscode' },
    }
    expect(await ingestion.ingest(message)).toBe(true)

    const stored = new ObservationStore(history.db).listAll()[0]!
    expect(stored.workspace.source).toBe('filesystem')
    expect(stored.workspace.root).toBe('/inferred')
    history.close()
  })

  it('anchors an episode to the vouched workspace', async () => {
    const { root, file } = workspaceOnDisk()
    const { history, ingestion, now } = service(root)
    const editorMessage = (
      seq: number,
    ): NativeObservation => ({
      v: 1,
      type: 'observation',
      collectorSession: 'editor-live',
      seq,
      observedAtMs: now + seq * 1000,
      app: { pid: 0, bundleId: 'com.microsoft.VSCode', name: 'Visual Studio Code' },
      window: { document: file, title: 'main.ts' },
      workspace: { root, title: 'vouched' },
      privacy: { secure: false, protected: false },
      source: { provider: 'companion', adapter: 'vscode' },
    })
    const results = [
      await ingestion.ingest(editorMessage(1)),
      await ingestion.ingest(editorMessage(2)),
    ]
    expect(results).toEqual([true, true])
    const episodes = new EpisodeStore(history.db).listRecent({ limit: 10 })
    expect(episodes).toHaveLength(1)
    expect(episodes[0]!.threadKey ?? episodes[0]!.id).toBeTruthy()
    expect(
      history.db.prepare(
        'SELECT DISTINCT workspace_source, workspace_root FROM observations',
      ).all(),
    ).toEqual([{ workspace_source: 'companion', workspace_root: root }])
    history.close()
  })
})

function editorMessage(input: {
  seq: number
  bundleId: string
  name: string
  file: string
  root: string
  now: number
}): NativeObservation {
  return {
    v: 1,
    type: 'observation',
    collectorSession: 'editor-claim',
    seq: input.seq,
    observedAtMs: input.now,
    app: { pid: 0, bundleId: input.bundleId, name: input.name },
    window: { document: input.file, title: 'main.ts' },
    workspace: { root: input.root, title: 'vouched' },
    privacy: { secure: false, protected: false },
    source: { provider: 'companion', adapter: 'vscode' },
  }
}

describe('a declared identity is a claim, and the rules still decide (ADR 0011)', () => {
  it('stores nothing for an application the user has not allowed', async () => {
    const { root, file } = workspaceOnDisk()
    const { history, ingestion, now } = service(root)
    // The policy in `service` allows VS Code only.
    const stored = await ingestion.ingest(editorMessage({
      seq: 1,
      bundleId: 'com.todesktop.230313mzl4w4u92',
      name: 'Cursor',
      file,
      root,
      now,
    }))
    expect(stored).toBe(false)
    expect(new ObservationStore(history.db).count()).toBe(0)
    history.close()
  })

  it('drops a claim naming a protected application', async () => {
    const { root, file } = workspaceOnDisk()
    const { history, ingestion, now } = service(root, {
      extraRules: [{
        id: PolicyRuleId('allow-1password'),
        dimension: 'app',
        action: 'allow',
        matcher: 'exact',
        pattern: 'com.1password.1password',
        builtIn: false,
        createdAtMs: 1,
        updatedAtMs: 1,
      }],
    })
    // Even allowed by the user, a password manager is protected by the built-in
    // list: declaring the identity cannot unlock it.
    const stored = await ingestion.ingest(editorMessage({
      seq: 1,
      bundleId: 'com.1password.1password',
      name: '1Password',
      file,
      root,
      now,
    }))
    expect(stored).toBe(false)
    expect(new ObservationStore(history.db).count()).toBe(0)
    history.close()
  })

  it('records an allowed claim as coming from a companion', async () => {
    const { root, file } = workspaceOnDisk()
    const { history, ingestion, now } = service(root)
    expect(await ingestion.ingest(editorMessage({
      seq: 1,
      bundleId: 'com.microsoft.VSCode',
      name: 'Cursor',
      file,
      root,
      now,
    }))).toBe(true)
    const stored = new ObservationStore(history.db).listAll()[0]!
    // The identity is what the extension claimed; the provenance says a
    // companion claimed it, which is the difference the audit depends on.
    expect(stored.app.bundleId).toBe('com.microsoft.VSCode')
    expect(stored.source.provider).toBe('companion')
    history.close()
  })
})
