import {
  readFileSync,
} from 'node:fs'
import path from 'node:path'
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest'
import {
  name,
  resolveHistoryDataDirectory,
} from '../src/index.js'
import { PHASE1_SUPPORTED_BUNDLE_IDS } from '../src/shared/index.js'

const originalDshHome = process.env.DSH_HOME

afterEach(() => {
  if (originalDshHome === undefined) {
    delete process.env.DSH_HOME
  } else {
    process.env.DSH_HOME = originalDshHome
  }
})

describe('repository scaffold', () => {
  it('exports the plugin identity', () => {
    expect(name).toBe('dsh-computer-history')
  })

  it('keeps default history under DSH_HOME', () => {
    process.env.DSH_HOME = '/tmp/dsh-history-test-home'
    expect(resolveHistoryDataDirectory()).toBe(
      path.resolve(
        '/tmp/dsh-history-test-home/computer-history',
      ),
    )
    expect(resolveHistoryDataDirectory({
      dataDirectory: '/tmp/explicit-history',
    })).toBe('/tmp/explicit-history')
  })

  it('keeps Host and native Phase 1 bundle allowlists identical', () => {
    const swift = readFileSync(
      new URL(
        '../native/macos/Sources/ComputerHistoryCollector/SupportedApps.swift',
        import.meta.url,
      ),
      'utf8',
    )
    // The native side keeps adapters in one registry (`Phase1Adapter`
    // entries with a `bundleIds` array), so the guard reads the arrays rather
    // than per-bundle comparisons in code.
    const nativeBundles = [
      ...swift.matchAll(/bundleIds:\s*\[([^\]]*)\]/g),
    ].flatMap(match =>
      [...match[1]!.matchAll(/"([^"]+)"/g)].map(inner => inner[1]!),
    ).toSorted()

    expect(nativeBundles.length).toBeGreaterThan(0)
    expect(nativeBundles).toEqual(
      [...PHASE1_SUPPORTED_BUNDLE_IDS].toSorted(),
    )
    expect(nativeBundles).not.toContain('com.google.Chrome')
    expect(nativeBundles).not.toContain('com.apple.Safari')
  })

  it('uses document-relative browser API routes', () => {
    const source = readFileSync(
      new URL('../src/client/index.ts', import.meta.url),
      'utf8',
    )
    const routeSource = readFileSync(
      new URL('../src/client/api-route.ts', import.meta.url),
      'utf8',
    )
    expect(source).toContain(
      'fetch(historyApiPath(path), init)',
    )
    expect(routeSource).toContain(
      "'api/computer-history'",
    )
    expect(routeSource).not.toContain(
      "'/api/computer-history'",
    )
  })
})
