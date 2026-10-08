import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildEditorPayload,
  declaredIdentity,
  surfaceKindOf,
  taskVerificationEvent,
} from '../src/payload'

const SOURCE_DIR = path.join(import.meta.dirname, '..', 'src')

describe('editor companion payload (ADR 0009)', () => {
  it('carries exactly the editor metadata and the envelope', () => {
    const payload = buildEditorPayload({
      identity: { bundleId: 'com.microsoft.VSCode', name: 'Visual Studio Code' },
      metadata: {
        workspaceRoot: '/Users/someone/Projects/demo',
        filePath: '/Users/someone/Projects/demo/src/main.ts',
        languageId: 'typescript',
        surfaceKind: 'editor',
        title: 'main.ts',
      },
      session: 'vscode-test',
      seq: 4,
      observedAtMs: 1_000,
    })
    expect(Object.keys(payload).toSorted()).toEqual([
      'app', 'editorSession', 'filePath', 'languageId', 'observedAtMs', 'seq',
      'source', 'surfaceKind', 'title', 'workspaceRoot',
    ])
    expect(payload.source).toBe('editor')
  })

  it('carries the closed save-event vocabulary', () => {
    const payload = buildEditorPayload({
      identity: { bundleId: 'com.microsoft.VSCode', name: 'Visual Studio Code' },
      metadata: {
        workspaceRoot: '/repo',
        filePath: '/repo/src/main.ts',
        event: 'save',
      },
      session: 's',
      seq: 2,
      observedAtMs: 2,
    })
    expect(payload.event).toBe('save')
    expect(Object.keys(payload)).not.toContain('text')
  })

  it('has no parameter a document body could travel in', () => {
    // Passing a document-like object through the metadata shape cannot leak its
    // text: the shape has fields for paths and identifiers, and the builder
    // copies only those it names.
    const documentLike = {
      workspaceRoot: '/repo',
      text: 'secret document body',
      getText: () => 'secret document body',
      selection: 'secret selection',
    }
    const payload = buildEditorPayload({
      identity: { bundleId: 'com.microsoft.VSCode', name: 'Visual Studio Code' },
      metadata: documentLike,
      session: 's',
      seq: 1,
      observedAtMs: 1,
    })
    const serialised = JSON.stringify(payload)
    expect(serialised).not.toContain('secret')
    expect(serialised).not.toContain('getText')
  })

  it('maps task outcomes without carrying task text', () => {
    expect(taskVerificationEvent({ kind: 'build', exitCode: 0 })).toBe('verify-build-success')
    expect(taskVerificationEvent({ kind: 'test', exitCode: 1 })).toBe('verify-test-failure')
    expect(taskVerificationEvent({ kind: 'build', exitCode: 0 })).toBe('verify-build-success')
    expect(taskVerificationEvent({ kind: 'other', exitCode: 2 })).toBe('verify-other-failure')
    expect(taskVerificationEvent({ kind: 'test' })).toBeUndefined()
  })

  it('names the surface the editor is showing', () => {
    expect(surfaceKindOf({ isDiff: false, isTerminal: false })).toBe('editor')
    expect(surfaceKindOf({ isDiff: true, isTerminal: false })).toBe('diff')
    expect(surfaceKindOf({ isDiff: false, isTerminal: true })).toBe('terminal')
  })
})

describe('editor runtime routing', () => {
  it('uses the active document workspace and treats HTTP rejection as a failed send', () => {
    const source = readFileSync(path.join(SOURCE_DIR, 'extension.ts'), 'utf8')
    expect(source).toContain('savedDocument ?? editor?.document')
    expect(source).toContain('getWorkspaceFolder(document.uri)')
    expect(source).toContain('randomUUID()')
    expect(source).toContain('response.status === 202')
    expect(source).toContain('send not stored:')
    expect(source).toContain('send rejected: HTTP')
    expect(source).toContain('credentialPromise')
    expect(source).toContain('pairing credential update failed')
    expect(source).toContain('claimPendingBootstrap(report)')
    expect(source).toContain("split(/[\\\\/]/)")
  })
})

describe('the extension never reads what ADR 0002 forbids', () => {
  // Calibrated both ways: the pattern must match a forbidden call (red) and the
  // real sources must not contain one (green).
  const FORBIDDEN = /getText\s*\(|\.selection\b|document\.text\b|lineAt\s*\(|getWordRangeAtPosition\s*\(|\.task\.(?:name|source)\b|commandLine\b/

  it('would catch a forbidden read', () => {
    expect(FORBIDDEN.test('const body = editor.document.getText()')).toBe(true)
    expect(FORBIDDEN.test('editor.document.text')).toBe(true)
    expect(FORBIDDEN.test('const s = editor.selection')).toBe(true)
    expect(FORBIDDEN.test('event.execution.task.name')).toBe(true)
    expect(FORBIDDEN.test('execution.commandLine')).toBe(true)
  })

  it('finds none in the extension sources', () => {
    const offenders: string[] = []
    for (const name of readdirSync(SOURCE_DIR)) {
      if (!name.endsWith('.ts')) continue
      const source = readFileSync(path.join(SOURCE_DIR, name), 'utf8')
      for (const [index, line] of source.split('\n').entries()) {
        if (FORBIDDEN.test(line)) offenders.push(`${name}:${index + 1}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('the identity an editor declares (ADR 0011)', () => {
  it('maps known products to the id the allow-list uses', () => {
    expect(declaredIdentity('Visual Studio Code')).toEqual({
      bundleId: 'com.microsoft.VSCode',
      name: 'Visual Studio Code',
    })
    expect(declaredIdentity('Cursor').bundleId).toBe('com.todesktop.230313mzl4w4u92')
    expect(declaredIdentity('Windsurf').bundleId).toBe('com.exafunction.windsurf')
  })

  it('gives an unknown editor a readable id of its own', () => {
    // The point of the general path: a new editor needs no Host release, and the
    // user decides whether to allow it like any other application.
    expect(declaredIdentity('Some New Editor')).toEqual({
      bundleId: 'com.dsh.editor.some-new-editor',
      name: 'Some New Editor',
    })
    expect(declaredIdentity('  ').bundleId).toBe('com.dsh.editor.unknown')
  })

  it('carries the identity into the wire payload', () => {
    const payload = buildEditorPayload({
      identity: declaredIdentity('Cursor'),
      metadata: { workspaceRoot: '/repo', filePath: '/repo/src/main.ts' },
      session: 's',
      seq: 1,
      observedAtMs: 1,
    })
    expect(payload.app).toEqual({
      bundleId: 'com.todesktop.230313mzl4w4u92',
      name: 'Cursor',
    })
    // What Cursor would send is a shape the Host already accepts; the intake
    // tests prove it, this proves the client produces it.
    expect(Object.keys(payload).toSorted()).toEqual([
      'app', 'editorSession', 'filePath', 'observedAtMs', 'seq', 'source',
      'workspaceRoot',
    ])
  })
})
