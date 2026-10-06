import { describe, expect, it } from 'vitest'
import {
  COMPANION_BUNDLE_ID,
  PHASE1_ADAPTERS,
} from '../../src/shared/index.js'
import { companionObservation } from '../../src/host/companion/observation.js'

describe('companion observation', () => {
  it('carries companion provenance and the synthetic bundle id', () => {
    const observation = companionObservation({
      source: 'browser',
      origin: 'https://example.test',
      path: '/docs/guide',
      title: 'Example page',
      incognito: false,
      browserSession: 'session-1',
      seq: 7,
      observedAtMs: 12_345,
    })

    expect(observation.source).toEqual({
      provider: 'companion',
      adapter: 'browser',
    })
    expect(observation.app.bundleId).toBe(COMPANION_BUNDLE_ID)
    expect(observation.window?.url).toBe('https://example.test/docs/guide')
    expect(observation.window?.title).toBe('Example page')
    expect(observation.collectorSession).toBe('session-1')
    expect(observation.seq).toBe(7)
    // Nothing about the page is read, so nothing else can be carried.
    expect(observation.element).toBeUndefined()
    expect(observation.privacy.secure).toBe(false)
  })

  it('keeps the synthetic bundle id in the adapter table', () => {
    // The constant and the table must not drift: the constant is what the
    // companion reports, the table is what the Host resolves.
    const browser = PHASE1_ADAPTERS.find(entry => entry.id === 'browser')
    expect(browser?.bundleIds).toContain(COMPANION_BUNDLE_ID)
  })
})

describe('editor observations (ADR 0009)', () => {
  it('derives a short workspace title from a native Windows path', () => {
    const observation = companionObservation({
      source: 'editor',
      app: { bundleId: 'com.microsoft.VSCode', name: 'Visual Studio Code' },
      workspaceRoot: 'C:\\Users\\someone\\Projects\\demo',
      filePath: 'C:\\Users\\someone\\Projects\\demo\\src\\main.ts',
      editorSession: 'editor-win',
      seq: 1,
      observedAtMs: 20_000,
    })
    expect(observation.workspace?.title).toBe('demo')
  })

  it('maps the editor payload to a file resource with companion provenance', () => {
    const observation = companionObservation({
      source: 'editor',
      app: { bundleId: 'com.microsoft.VSCode', name: 'Visual Studio Code' },
      workspaceRoot: '/Users/someone/Projects/demo',
      filePath: '/Users/someone/Projects/demo/src/main.ts',
      languageId: 'typescript',
      surfaceKind: 'editor',
      title: 'main.ts',
      editorSession: 'editor-1',
      seq: 3,
      observedAtMs: 20_000,
    })
    expect(observation.window?.document).toBe(
      '/Users/someone/Projects/demo/src/main.ts',
    )
    expect(observation.source).toEqual({ provider: 'companion', adapter: 'vscode' })
    expect(JSON.stringify(observation)).not.toContain('secret')
  })
})

describe('the adapter an editor observation is recorded with', () => {
  // `source.adapter` is the "which adapter saw this" column and it reaches the export. It was hardcoded to
  // 'vscode' for every editor payload, so a row from IntelliJ said VS Code - while the comment right above it
  // promised "the real editor adapter". The bundle the editor claimed is already in the payload and the repo
  // has a table that maps bundles to adapters, so the value is derived rather than assumed.
  const editor = (bundleId: string) => ({
    source: 'editor' as const,
    app: { bundleId, name: 'an editor' },
    workspaceRoot: '/tmp/ws',
    surfaceKind: 'editor' as const,
    editorSession: 'adapter-probe',
    seq: 1,
    observedAtMs: 1_760_000_000_000,
  })

  it('names the adapter the bundle maps to', () => {
    expect(companionObservation(editor('com.jetbrains.intellij')).source.adapter).toBe('jetbrains')
    expect(companionObservation(editor('com.microsoft.VSCode')).source.adapter).toBe('vscode')
  })

  it('says generic rather than naming an adapter it does not know', () => {
    expect(companionObservation(editor('com.example.not-in-the-table')).source.adapter).toBe('generic')
  })
})
