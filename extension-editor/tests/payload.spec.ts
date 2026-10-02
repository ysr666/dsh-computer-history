import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildEditorPayload,
  surfaceKindOf,
} from '../src/payload'

const SOURCE_DIR = path.join(import.meta.dirname, '..', 'src')

describe('editor companion payload (ADR 0009)', () => {
  it('carries exactly the editor metadata and the envelope', () => {
    const payload = buildEditorPayload({
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
      'editorSession', 'filePath', 'languageId', 'observedAtMs', 'seq', 'source',
      'surfaceKind', 'title', 'workspaceRoot',
    ])
    expect(payload.source).toBe('editor')
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
      metadata: documentLike,
      session: 's',
      seq: 1,
      observedAtMs: 1,
    })
    const serialised = JSON.stringify(payload)
    expect(serialised).not.toContain('secret')
    expect(serialised).not.toContain('getText')
  })

  it('names the surface the editor is showing', () => {
    expect(surfaceKindOf({ isDiff: false, isTerminal: false })).toBe('editor')
    expect(surfaceKindOf({ isDiff: true, isTerminal: false })).toBe('diff')
    expect(surfaceKindOf({ isDiff: false, isTerminal: true })).toBe('terminal')
  })
})

describe('the extension never reads what ADR 0002 forbids', () => {
  // Calibrated both ways: the pattern must match a forbidden call (red) and the
  // real sources must not contain one (green).
  const FORBIDDEN = /getText\s*\(|\.selection\b|document\.text\b|lineAt\s*\(|getWordRangeAtPosition\s*\(/

  it('would catch a forbidden read', () => {
    expect(FORBIDDEN.test('const body = editor.document.getText()')).toBe(true)
    expect(FORBIDDEN.test('editor.document.text')).toBe(true)
    expect(FORBIDDEN.test('const s = editor.selection')).toBe(true)
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
