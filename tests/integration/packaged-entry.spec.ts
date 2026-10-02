import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * The packaged artifact starts.
 *
 * `pnpm pack:plugin` produces a tarball whose `lib/` is byte-identical to this
 * repository's, and the Host's own runtime path is verified elsewhere
 * (`[active]` on a checkout install). What a manual Host restart would otherwise
 * be the only evidence for is that the **build output itself** boots: this test
 * loads `lib/index.js` - the file the tarball ships - and runs its `apply`
 * against a stub context, so "it starts" is a claim the gate can check.
 *
 * It deliberately does not claim to replace the Host-managed start: assembling a
 * profile bundle happens at Host startup, and that stays in `docs/release.md`.
 */
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface StubState {
  readonly routes: Map<string, unknown>
  readonly effects: number
  readonly disposers: Array<() => void>
}

function stubContext(): { ctx: unknown, state: StubState } {
  const state: StubState = { routes: new Map(), effects: 0, disposers: [] }
  const methods = ['on', 'off', 'emit', 'parallel', 'waterfall', 'bail', 'serial']
  const handler: ProxyHandler<Record<string, unknown>> = {
    get: (_target, property) => {
      if (property === 'effect') {
        return (factory: () => unknown) => {
          state.effects += 1
          const disposer = factory()
          if (typeof disposer === 'function') state.disposers.push(disposer as () => void)
          return () => {}
        }
      }
      if (property === 'connection') {
        return {
          fetch: {
            register: (route: { path: string }) => {
              state.routes.set(route.path, route)
              return () => {}
            },
          },
        }
      }
      if (property === 'logger') return { info() {}, warn() {}, error() {} }
      // The plugin reads back the service it contributes; a no-op of the same
      // shape is enough for setup, and this test asserts registration, not
      // behaviour.
      if (property === 'get' || property === 'require') {
        return () => new Proxy(() => undefined, handler)
      }
      // Collection accessors must return something iterable: a plugin that lists
      // workspaces calls `list()` and spreads the result.
      if (property === 'list' || property === 'all' || property === 'entries') {
        return () => []
      }
      if (methods.includes(String(property))) return () => () => {}
      // Any other service the plugin touches is a no-op function that also
      // behaves like an object: enough to let setup run, and nothing pretends to
      // be a real service.
      return new Proxy(() => undefined, handler)
    },
  }
  return { ctx: new Proxy({} as Record<string, unknown>, handler), state }
}

describe('the build output the tarball ships', () => {
  it('applies without throwing and registers its routes', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-packaged-'))
    roots.push(root)
    const plugin = await import('../../lib/index.js')
    expect(typeof plugin.apply).toBe('function')
    expect(plugin.name).toBe('dsh-computer-history')

    const { ctx, state } = stubContext()
    await expect(
      plugin.apply(ctx as never, {
        enabled: false,
        dataDirectory: path.join(root, 'history'),
      }),
    ).resolves.toBeUndefined()

    const paths = [...state.routes.keys()]
    expect(paths).toContain('/api/computer-history/state')
    expect(paths).toContain('/api/computer-history/export')
    expect(paths).toContain('/api/computer-history/retention')
    // One registration per path: the registry keys routes by exact path, so a
    // duplicate would have taken the fiber down in 2.6 and must never return.
    expect(new Set(paths).size).toBe(paths.length)
  })
})
