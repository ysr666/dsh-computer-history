import {
  readFileSync,
  readdirSync,
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

/**
 * The cross-platform id contract as data: which ids belong to which platform. Guards below compare
 * each platform's table against its own ids, so a win32 id can never be mistaken for a darwin one.
 */
function fixtureAdapters(): readonly {
  adapter: string
  ids: Readonly<Record<string, readonly string[]>>
}[] {
  const fixture = JSON.parse(
    readFileSync(
      new URL('./conformance/fixtures/adapters.json', import.meta.url),
      'utf8',
    ),
  ) as {
    adapters: readonly {
      adapter: string
      ids: Readonly<Record<string, readonly string[]>>
    }[]
  }
  return fixture.adapters
}

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

  it('keeps the macOS adapter table identical to the Host table on the darwin ids', () => {
    const windowsIds = new Set(
      fixtureAdapters().flatMap(entry => entry.ids.win32 ?? []),
    )
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
          focusedElementPolicy:
            /focusedElementPolicy:\s*\.(\w+)/.exec(chunk)?.[1] === 'windowOnly'
              ? 'window-only'
              : 'require',
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
      [...PHASE1_SUPPORTED_BUNDLE_IDS]
        .filter(id => !windowsIds.has(id))
        .toSorted(),
    )
    expect(nativeBundles).not.toContain('com.google.Chrome')
    expect(nativeBundles).not.toContain('com.apple.Safari')

    // Field-by-field: a bundle that maps to a different adapter id, or an
    // adapter whose surface kind or title policy differs between the two
    // languages, would silently change what the Host stores.
    for (const adapter of PHASE1_ADAPTERS) {
      const native = nativeAdapters.find(entry => entry.id === adapter.id)
      expect(native, `native adapter ${adapter.id}`).toBeDefined()
      // The Swift table stays darwin-only: win32 ids live in the Host table and in the Windows
      // collector, and the fixture declares which ids are whose.
      expect(native!.bundleIds.toSorted()).toEqual(
        adapter.bundleIds
          .filter(id => !windowsIds.has(id))
          .toSorted(),
      )
      expect(native!.surfaceKind).toBe(adapter.surfaceKind)
      expect(native!.suppressesWindowTitle).toBe(
        adapter.suppressesWindowTitle,
      )
      expect(native!.focusedElementPolicy).toBe(
        adapter.focusedElementPolicy,
      )
    }
  })

  it('keeps the Windows collector adapter table identical to the fixture win32 ids', () => {
    const rust = readFileSync(
      new URL(
        '../native/windows/src/adapters.rs',
        import.meta.url,
      ),
      'utf8',
    )
    // Line comments are stripped first: a commented-out entry is not a live entry, and treating it
    // as one is how this guard was first bypassed.
    const active = rust
      .split('\n')
      .filter(line => !line.trimStart().startsWith('//'))
      .join('\n')
    const windowsAdapters = active.split('\n    Adapter {').slice(1).map(
      (chunk) => {
        const id = /id:\s*"([^"]+)"/.exec(chunk)
        const idsBlock = /ids:\s*&\[([^\]]*)\]/.exec(chunk)
        const suppresses = /suppresses_window_title:\s*(true|false)/.exec(
          chunk,
        )
        const policy = /focus_policy:\s*FocusPolicy::(\w+)/.exec(chunk)
        // A missing field must fail the guard rather than default to a value
        // that happens to match.
        expect(id, 'an Adapter entry has no id').not.toBeNull()
        expect(idsBlock, `adapter ${id?.[1]} has no ids array`).not.toBeNull()
        expect(
          suppresses,
          `adapter ${id?.[1]} has no suppresses_window_title`,
        ).not.toBeNull()
        expect(policy, `adapter ${id?.[1]} has no focus_policy`).not.toBeNull()
        return {
          id: id![1]!,
          ids: [...(idsBlock?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(
            match => match[1]!,
          ),
          suppressesWindowTitle: suppresses![1] === 'true',
          focusPolicy: policy![1] === 'WindowOnly'
            ? 'window-only'
            : 'require',
        }
      },
    )

    // Reverse coverage: the collector must resolve exactly the adapters the fixture declares win32
    // ids for. Deleting an entry, or commenting it out, fails here.
    const declared = fixtureAdapters().filter(
      entry => (entry.ids.win32 ?? []).length > 0,
    )
    expect(windowsAdapters.map(entry => entry.id).toSorted()).toEqual(
      declared.map(entry => entry.adapter).toSorted(),
    )

    for (const entry of declared) {
      const collector = windowsAdapters.find(
        candidate => candidate.id === entry.adapter,
      )
      expect(collector, `Rust adapter ${entry.adapter}`).toBeDefined()
      expect(collector!.ids.toSorted()).toEqual(
        [...entry.ids.win32!].toSorted(),
      )
      const host = PHASE1_ADAPTERS.find(
        candidate => candidate.id === entry.adapter,
      )
      expect(host, `Host adapter ${entry.adapter}`).toBeDefined()
      expect(collector!.suppressesWindowTitle).toBe(
        host!.suppressesWindowTitle,
      )
      expect(collector!.focusPolicy).toBe(host!.focusedElementPolicy)
      for (const id of collector!.ids) {
        expect(host!.bundleIds).toContain(id)
      }
    }
  })

  it('keeps the collector refusal reasons aligned with the fixture', () => {
    const collector = readFileSync(
      new URL('../native/windows/src/collector.rs', import.meta.url),
      'utf8',
    )
    const fixture = JSON.parse(
      readFileSync(
        new URL('./conformance/fixtures/adapters.json', import.meta.url),
        'utf8',
      ),
    ) as { refusals: readonly { reason: string }[] }
    // `not-an-adapter` is the Host's own decision; the collector must produce the rest of the names.
    const collectorReasons = fixture.refusals
      .map(entry => entry.reason)
      .filter(reason => reason !== 'not-an-adapter')
    expect(collectorReasons.length).toBeGreaterThan(0)
    for (const reason of collectorReasons) {
      expect(collector, `collector reason ${reason}`).toContain(`"${reason}"`)
    }
  })

  it('centralizes document-relative browser API routes', () => {
    const apiSource = readFileSync(
      new URL('../src/client/api.ts', import.meta.url),
      'utf8',
    )
    const clientDirectory = new URL('../src/client/', import.meta.url)
    const routeSource = readFileSync(
      new URL('../src/client/api-route.ts', import.meta.url),
      'utf8',
    )
    expect(apiSource).toContain('fetch(historyApiPath(path)')
    for (const file of readdirSync(clientDirectory)) {
      if (!file.endsWith('.ts') || file === 'api.ts') continue
      expect(
        readFileSync(new URL(file, clientDirectory), 'utf8'),
        `${file} must not own HTTP transport`,
      ).not.toContain('fetch(')
    }
    expect(routeSource).toContain("'api/computer-history'")
    expect(routeSource).not.toContain("'/api/computer-history'")
  })

  it('keeps locale and DSH runtime modules owned by the platform', () => {
    const entry = readFileSync(
      new URL('../src/client/index.ts', import.meta.url),
      'utf8',
    )
    const buildConfig = readFileSync(
      new URL('../tsdown.config.ts', import.meta.url),
      'utf8',
    )
    const manifest = JSON.parse(readFileSync(
      new URL('../package.json', import.meta.url),
      'utf8',
    )) as {
      dsh: { client: { inject: string[] } }
      peerDependencies: Record<string, string>
    }

    for (const moduleId of [
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-sidebar',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-settings',
    ]) {
      expect(buildConfig, `${moduleId} must stay external`).toContain(`'${moduleId}'`)
      expect(manifest.dsh.client.inject).toContain(moduleId)
      expect(manifest.peerDependencies).toHaveProperty(moduleId)
    }
    expect(entry).toContain("ctx.locale.register(HISTORY_LOCALE_NS")
    expect(entry).not.toMatch(/MutationObserver|document\.documentElement\.lang|navigator\.language/)
  })
})
