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
import {
  PHASE1_ADAPTERS,
  PHASE1_SUPPORTED_BUNDLE_IDS,
} from '../src/shared/index.js'

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

  it('keeps the Host and native adapter tables identical', () => {
    const swift = readFileSync(
      new URL(
        '../native/macos/Sources/ComputerHistoryCollector/SupportedApps.swift',
        import.meta.url,
      ),
      'utf8',
    )
    // Split on the initializer so each chunk is one registry entry; the struct
    // declaration and the array type have no parenthesis after the name.
    const nativeAdapters = swift.split('Phase1Adapter(').slice(1).map(
      (chunk) => {
        const bundleBlock = /bundleIds:\s*\[([^\]]*)\]/.exec(chunk)?.[1] ?? ''
        return {
          id: /id:\s*"([^"]+)"/.exec(chunk)?.[1] ?? '',
          bundleIds: [...bundleBlock.matchAll(/"([^"]+)"/g)].map(
            match => match[1]!,
          ),
          surfaceKind: /surfaceKind:\s*"([^"]+)"/.exec(chunk)?.[1] ?? '',
          suppressesWindowTitle:
            /suppressesWindowTitle:\s*(true|false)/.exec(chunk)?.[1] === 'true',
        }
      },
    )

    expect(nativeAdapters.length).toBe(PHASE1_ADAPTERS.length)

    const nativeBundles = nativeAdapters.flatMap(
      adapter => adapter.bundleIds,
    ).toSorted()
    expect(nativeBundles.length).toBeGreaterThan(0)
    expect(nativeBundles).toEqual(
      [...PHASE1_SUPPORTED_BUNDLE_IDS].toSorted(),
    )
    expect(nativeBundles).not.toContain('com.google.Chrome')
    expect(nativeBundles).not.toContain('com.apple.Safari')

    // Field-by-field: a bundle that maps to a different adapter id, or an
    // adapter whose surface kind or title policy differs between the two
    // languages, would silently change what the Host stores.
    for (const adapter of PHASE1_ADAPTERS) {
      const native = nativeAdapters.find(entry => entry.id === adapter.id)
      expect(native, `native adapter ${adapter.id}`).toBeDefined()
      expect(native!.bundleIds.toSorted()).toEqual(
        [...adapter.bundleIds].toSorted(),
      )
      expect(native!.surfaceKind).toBe(adapter.surfaceKind)
      expect(native!.suppressesWindowTitle).toBe(
        adapter.suppressesWindowTitle,
      )
    }
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
