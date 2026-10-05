import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { EpisodeDetail } from '../../src/shared/index.js'
import {
  ResumeOpenLaunchError,
  ResumeOpenRequestError,
  ResumeResourceOpener,
} from '../../src/host/resume/opener.js'

function episode(overrides: Partial<EpisodeDetail> = {}): EpisodeDetail {
  const file = {
    kind: 'file' as const,
    canonicalUri: pathToFileURL('/tmp/report.md').href,
    displayLabel: 'report.md',
  }
  return {
    id: 'episode:test' as never,
    startedAtMs: 1,
    endedAtMs: 2,
    boundary: { startReason: 'first-observation', endReason: 'timeout' },
    workspace: { root: '/tmp/project', title: 'project' },
    summaryKind: 'deterministic',
    summary: 'Worked in project.',
    summaryObservationIds: ['observation:1' as never],
    lastStrongResource: file,
    resources: [{ ...file, firstSeenAtMs: 1, lastSeenAtMs: 2, observationCount: 1 }],
    surfaces: [{
      bundleId: 'com.microsoft.VSCode',
      surfaceKind: 'editor',
      firstSeenAtMs: 1,
      lastSeenAtMs: 2,
      observationCount: 1,
    }],
    confidence: 1,
    state: 'closed',
    observationIds: ['observation:1' as never],
    ...overrides,
  }
}

function subprocess(outcome: { exitCode: number | null; signal: NodeJS.Signals | null } = {
  exitCode: 0,
  signal: null,
}) {
  const specs: unknown[] = []
  const spawn = vi.fn((spec: unknown) => {
    specs.push(spec)
    return { done: Promise.resolve(outcome) }
  })
  const resolveExecutable = vi.fn(async (command: string) => command)
  return { spawn, resolveExecutable, specs }
}

describe('ResumeResourceOpener', () => {
  it('keeps unverified platforms unsupported without probing an opener', async () => {
    const runtime = subprocess()
    const opener = new ResumeResourceOpener({
      subprocess: runtime as never,
      cwd: '/tmp',
      platform: 'linux',
    })

    await expect(opener.capability()).resolves.toEqual({
      available: false,
      reason: 'platform-unverified',
    })
    expect(runtime.resolveExecutable).not.toHaveBeenCalled()
  })

  it('opens only a stored file using explicit argv and the stored app bundle', async () => {
    const runtime = subprocess()
    const opener = new ResumeResourceOpener({
      subprocess: runtime as never,
      cwd: '/tmp',
      platform: 'darwin',
      exists: () => true,
    })

    await expect(opener.openEpisode(episode())).resolves.toEqual({
      status: 'opened',
      appBundleId: 'com.microsoft.VSCode',
      kind: 'file',
    })
    expect(runtime.resolveExecutable).toHaveBeenCalledWith('/usr/bin/open')
    expect(runtime.spawn).toHaveBeenCalledTimes(1)
    const spec = runtime.specs[0] as { argv: readonly string[] }
    expect(spec.argv).toEqual([
      '/usr/bin/open',
      '-b',
      'com.microsoft.VSCode',
      '/tmp/report.md',
    ])
  })

  it('falls back to the system default handler when the recorded app cannot open the resource', async () => {
    const specs: unknown[] = []
    const outcomes = [
      { exitCode: 1, signal: null },
      { exitCode: 0, signal: null },
    ] as const
    const runtime = {
      resolveExecutable: vi.fn(async (command: string) => command),
      spawn: vi.fn((spec: unknown) => {
        specs.push(spec)
        return { done: Promise.resolve(outcomes[specs.length - 1]!) }
      }),
    }
    const opener = new ResumeResourceOpener({
      subprocess: runtime as never,
      cwd: '/tmp',
      platform: 'darwin',
      exists: () => true,
    })

    await expect(opener.openEpisode(episode())).resolves.toEqual({
      status: 'opened',
      kind: 'file',
    })
    expect(runtime.spawn).toHaveBeenCalledTimes(2)
    expect((specs[0] as { argv: readonly string[] }).argv).toEqual([
      '/usr/bin/open', '-b', 'com.microsoft.VSCode', '/tmp/report.md',
    ])
    expect((specs[1] as { argv: readonly string[] }).argv).toEqual([
      '/usr/bin/open', '/tmp/report.md',
    ])
  })

  it('rejects a resource URI that was not stored on the episode', async () => {
    const opener = new ResumeResourceOpener({
      subprocess: subprocess() as never,
      cwd: '/tmp',
      platform: 'darwin',
      exists: () => true,
    })

    await expect(opener.openEpisode(
      episode(),
      pathToFileURL('/tmp/not-in-history.txt').href,
    )).rejects.toBeInstanceOf(ResumeOpenRequestError)
  })

  it('reports a stored local resource that no longer exists without launching anything', async () => {
    const runtime = subprocess()
    const opener = new ResumeResourceOpener({
      subprocess: runtime as never,
      cwd: '/tmp',
      platform: 'darwin',
      exists: () => false,
    })

    await expect(opener.openEpisode(episode())).resolves.toEqual({
      status: 'unsupported',
      reason: 'resource-missing',
    })
    expect(runtime.spawn).not.toHaveBeenCalled()
  })

  it('uses the recorded workspace root only when the episode has no resource', async () => {
    const runtime = subprocess()
    const opener = new ResumeResourceOpener({
      subprocess: runtime as never,
      cwd: '/tmp',
      platform: 'darwin',
      exists: () => true,
    })
    const withoutResources = episode({
      lastStrongResource: undefined,
      resources: [],
    } as never)

    await expect(opener.openEpisode(withoutResources)).resolves.toMatchObject({
      status: 'opened',
      kind: 'workspace',
    })
    const spec = runtime.specs[0] as { argv: readonly string[] }
    expect(spec.argv.at(-1)).toBe('/tmp/project')
  })

  it('does not hand unsupported URL schemes to the operating system', async () => {
    const opener = new ResumeResourceOpener({
      subprocess: subprocess() as never,
      cwd: '/tmp',
      platform: 'darwin',
      exists: () => true,
    })
    const unsafe = episode({
      lastStrongResource: {
        kind: 'url',
        canonicalUri: 'javascript:alert(1)',
      },
      resources: [],
    })

    await expect(opener.openEpisode(unsafe)).resolves.toEqual({
      status: 'unsupported',
      reason: 'unsupported-resource',
    })
  })

  it('reports a verified opener process failure instead of claiming success', async () => {
    const opener = new ResumeResourceOpener({
      subprocess: subprocess({ exitCode: 1, signal: null }) as never,
      cwd: '/tmp',
      platform: 'darwin',
      exists: () => true,
    })

    await expect(opener.openEpisode(episode())).rejects.toBeInstanceOf(
      ResumeOpenLaunchError,
    )
  })
})
