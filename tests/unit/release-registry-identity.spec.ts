import { describe, expect, it } from 'vitest'
import {
  inspectRegistryIdentity,
  lookupRegistryIdentity,
  waitForRegistryIdentity,
} from '../../scripts/release-registry-identity.mjs'

const ok = (data: unknown): Response => ({
  ok: true,
  status: 200,
  json: async () => data,
}) as Response

const status = (code: number): Response => ({
  ok: false,
  status: code,
}) as Response

describe('npm release registry identity', () => {
  it('probes the package at its exact version without accepting unrelated versions', async () => {
    const seen: string[] = []
    const result = await lookupRegistryIdentity({
      packageName: 'dsh-computer-history',
      version: '1.0.0',
      fetchImpl: async (url) => {
        seen.push(String(url))
        return ok({ dist: { shasum: 'abc123' } })
      },
    })
    expect(result).toEqual({ state: 'visible', sha1: 'abc123' })
    expect(seen).toEqual(['https://registry.npmjs.org/dsh-computer-history/1.0.0'])
  })

  it('refuses to treat a different existing npm tarball as a successful release', async () => {
    const result = await waitForRegistryIdentity({
      packageName: 'dsh-computer-history',
      version: '1.0.0',
      expectedSha1: 'expected',
      fetchImpl: async () => ok({ dist: { shasum: 'other' } }),
      attempts: 2,
      delayMs: 0,
      sleepImpl: async () => {},
    })
    expect(result).toEqual({ state: 'mismatch', attempt: 1, remoteSha1: 'other' })
  })

  it('waits for publication visibility but never mistakes a transient error for a missing package', async () => {
    let count = 0
    const fetchImpl = async () => {
      count += 1
      return count === 1 ? status(503) : count === 2 ? status(404) : ok({ dist: { shasum: 'exact' } })
    }
    const result = await waitForRegistryIdentity({
      packageName: 'dsh-computer-history',
      version: '1.0.0',
      expectedSha1: 'exact',
      fetchImpl,
      attempts: 4,
      delayMs: 0,
      sleepImpl: async () => {},
    })
    expect(result).toEqual({ state: 'exact', attempt: 3, remoteSha1: 'exact' })
  })

  it('fails closed on malformed metadata or a permanent HTTP error', async () => {
    const malformed = await lookupRegistryIdentity({
      packageName: 'dsh-computer-history',
      version: '1.0.0',
      fetchImpl: async () => ok({}),
    })
    expect(malformed.state).toBe('transient')
    const permanent = await inspectRegistryIdentity({
      packageName: 'dsh-computer-history',
      version: '1.0.0',
      fetchImpl: async () => status(403),
      attempts: 3,
      delayMs: 0,
      sleepImpl: async () => {},
    })
    expect(permanent.state).toBe('fatal')
    expect(permanent.attempt).toBe(1)
  })
})
