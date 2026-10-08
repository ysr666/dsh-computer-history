import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Explicitly version this contract when upgrading the verified DSH Host.
// Keeping the plugin build green is not proof the Host can load a new React.
const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  dependencies?: Record<string, string>
  devDependencies: Record<string, string>
  peerDependencies: Record<string, string>
  engines: { node: string }
}

describe('DSH Host dependency compatibility contract', () => {
  it('uses Host-provided React 18, not a newer private runtime', () => {
    expect(pkg.dependencies?.react).toBeUndefined()
    expect(pkg.peerDependencies.react).toBe('^18.2.0')
    expect(pkg.devDependencies.react).toMatch(/^18\./)
    expect(pkg.devDependencies['@types/react']).toMatch(/^18\./)
  })

  it('keeps developer tooling compatible with the supported Node 22 baseline', () => {
    expect(pkg.engines.node).toContain('^22.19.0')
    expect(pkg.devDependencies['@types/node']).toMatch(/^\^?22\./)
    // TypeScript 7 is a separately verified migration, not a routine bot bump.
    expect(pkg.devDependencies.typescript).toMatch(/^\^?6\./)
  })

  it('pins the development DSH family and preserves the rc.2 peer floor', () => {
    const dshDev = Object.entries(pkg.devDependencies)
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    expect(dshDev.length).toBeGreaterThan(0)
    for (const [name, version] of dshDev) {
      expect(version, name).toBe('0.2.0-rc.2')
    }

    const dshPeers = Object.entries(pkg.peerDependencies)
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    expect(dshPeers.length).toBeGreaterThan(0)
    for (const [name, range] of dshPeers) {
      expect(range, name).toBe('>=0.2.0-rc.2 <0.3.0')
    }
  })
})
