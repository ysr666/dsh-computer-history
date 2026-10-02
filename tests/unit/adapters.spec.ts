import { describe, expect, it } from 'vitest'
import {
  PHASE1_ADAPTERS,
  PHASE1_SUPPORTED_BUNDLE_IDS,
  phase1AdapterDefinition,
} from '../../src/shared/index.js'
import { phase1AdapterForBundle } from '../../src/host/ingestion/normalize.js'

describe('Phase 1 adapter table', () => {
  it('has unique adapter ids', () => {
    const ids = PHASE1_ADAPTERS.map(adapter => adapter.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('binds every bundle id to exactly one adapter', () => {
    const bundles = PHASE1_ADAPTERS.flatMap(
      adapter => adapter.bundleIds,
    )
    expect(new Set(bundles).size).toBe(bundles.length)
    expect([...PHASE1_SUPPORTED_BUNDLE_IDS].toSorted()).toEqual(
      [...bundles].toSorted(),
    )
    for (const adapter of PHASE1_ADAPTERS) {
      expect(adapter.bundleIds.length).toBeGreaterThan(0)
      expect(adapter.surfaceKind).not.toBe('unknown')
    }
  })

  it('resolves every supported bundle and nothing else', () => {
    for (const adapter of PHASE1_ADAPTERS) {
      for (const bundle of adapter.bundleIds) {
        expect(phase1AdapterForBundle(bundle)).toBe(adapter.id)
        expect(phase1AdapterDefinition(adapter.id)).toEqual(adapter)
      }
    }
    // Unknown or hostile bundle ids must not fall through to a surface: the
    // caller drops the observation instead.
    expect(phase1AdapterForBundle('com.google.Chrome')).toBeUndefined()
    expect(phase1AdapterForBundle('org.mozilla.firefox')).toBeUndefined()
    expect(phase1AdapterForBundle('')).toBeUndefined()
    expect(phase1AdapterForBundle('generic')).toBeUndefined()
  })

  it('declares a focus policy per adapter and keeps JetBrains window-only', () => {
    for (const adapter of PHASE1_ADAPTERS) {
      expect(['require', 'window-only']).toContain(
        adapter.focusedElementPolicy,
      )
    }
    // ADR 0006: the IntelliJ platform hands out an element reference that
    // rejects every read, so its adapter accepts window metadata without
    // element fields. Everything else keeps the default.
    expect(phase1AdapterForBundle('com.google.android.studio')).toBe(
      'jetbrains',
    )
    expect(
      phase1AdapterDefinition('jetbrains')?.focusedElementPolicy,
    ).toBe('window-only')
    expect(
      PHASE1_ADAPTERS
        .filter(adapter => adapter.focusedElementPolicy === 'window-only')
        .map(adapter => adapter.id),
    ).toEqual(['jetbrains'])
  })

  it('keeps terminal surfaces free of titles', () => {
    const terminal = phase1AdapterForBundle('com.apple.Terminal')
    expect(terminal).toBe('terminal')
    expect(phase1AdapterDefinition('terminal')?.suppressesWindowTitle).toBe(
      true,
    )
    expect(
      phase1AdapterDefinition('terminal')?.documentResourceKind,
    ).toBe('directory')
    expect(
      phase1AdapterDefinition('vscode')?.documentResourceKind,
    ).toBe('file')
  })
})
