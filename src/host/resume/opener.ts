import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  EpisodeDetail,
  ResourceIdentity,
  ResumeOpenCapability,
  ResumeOpenResult,
} from '../../shared/index.js'

export class ResumeOpenRequestError extends Error {}
export class ResumeOpenLaunchError extends Error {}

type SubprocessFace = Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>

export interface ResumeResourceOpenerOptions {
  readonly subprocess: SubprocessFace
  readonly cwd: string
  readonly platform?: NodeJS.Platform
  readonly exists?: (path: string) => boolean
}

function episodeResources(episode: EpisodeDetail): readonly ResourceIdentity[] {
  const resources: ResourceIdentity[] = []
  if (episode.lastStrongResource) resources.push(episode.lastStrongResource)
  resources.push(...episode.resources)
  const unique = new Map<string, ResourceIdentity>()
  for (const resource of resources) {
    unique.set(`${resource.kind}\u0000${resource.canonicalUri}`, resource)
  }
  return [...unique.values()]
}

function workspaceResource(episode: EpisodeDetail): ResourceIdentity | undefined {
  const root = episode.workspace?.root
  if (!root || !path.isAbsolute(root)) return undefined
  return {
    kind: 'workspace',
    canonicalUri: pathToFileURL(root).href,
    ...(episode.workspace?.title ? { displayLabel: episode.workspace.title } : {}),
  }
}

function requestedResource(
  episode: EpisodeDetail,
  canonicalUri?: string,
): ResourceIdentity | undefined {
  const resources = episodeResources(episode)
  if (canonicalUri !== undefined) {
    const match = resources.find(resource => resource.canonicalUri === canonicalUri)
    if (!match) {
      throw new ResumeOpenRequestError(
        'requested resource is not part of the stored episode',
      )
    }
    return match
  }
  return resources[0] ?? workspaceResource(episode)
}

function openArgument(resource: ResourceIdentity): string | undefined {
  let url: URL
  try {
    url = new URL(resource.canonicalUri)
  } catch {
    return undefined
  }
  if (resource.kind === 'url') {
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : undefined
  }
  if (url.protocol !== 'file:') return undefined
  try {
    return fileURLToPath(url)
  } catch {
    return undefined
  }
}

function preferredBundleId(episode: EpisodeDetail): string | undefined {
  return episode.surfaces
    .toSorted((a, b) => b.lastSeenAtMs - a.lastSeenAtMs)[0]
    ?.bundleId
}

/**
 * Host-owned explicit Continue action. macOS is the only platform verified in
 * Phase 2B. It uses dsh-subprocess with a fixed executable + argv; no shell is
 * involved and the browser never supplies an arbitrary path.
 */
export class ResumeResourceOpener {
  private readonly subprocess: SubprocessFace
  private readonly cwd: string
  private readonly platform: NodeJS.Platform
  private readonly exists: (path: string) => boolean
  private openerPromise: Promise<string | undefined> | undefined

  public constructor(options: ResumeResourceOpenerOptions) {
    this.subprocess = options.subprocess
    this.cwd = options.cwd
    this.platform = options.platform ?? process.platform
    this.exists = options.exists ?? existsSync
  }

  private resolveOpener(): Promise<string | undefined> {
    if (this.platform !== 'darwin') return Promise.resolve(undefined)
    this.openerPromise ??= this.subprocess
      .resolveExecutable('/usr/bin/open')
      .catch(() => undefined)
    return this.openerPromise
  }

  public async capability(): Promise<ResumeOpenCapability> {
    if (this.platform !== 'darwin') {
      return { available: false, reason: 'platform-unverified' }
    }
    return await this.resolveOpener()
      ? { available: true }
      : { available: false, reason: 'opener-unavailable' }
  }

  public async openEpisode(
    episode: EpisodeDetail,
    resourceCanonicalUri?: string,
  ): Promise<ResumeOpenResult> {
    // Validate the browser-named resource against stored evidence before any
    // platform capability decision. Unsupported platforms must not turn an
    // untrusted URI into an accepted request shape.
    const resource = requestedResource(episode, resourceCanonicalUri)
    if (!resource) {
      return { status: 'unsupported', reason: 'no-openable-resource' }
    }
    const capability = await this.capability()
    if (!capability.available) {
      return {
        status: 'unsupported',
        reason: capability.reason ?? 'opener-unavailable',
      }
    }
    const target = openArgument(resource)
    if (!target) {
      return { status: 'unsupported', reason: 'unsupported-resource' }
    }
    if (resource.kind !== 'url' && !this.exists(target)) {
      return { status: 'unsupported', reason: 'resource-missing' }
    }
    const opener = await this.resolveOpener()
    if (!opener) {
      return { status: 'unsupported', reason: 'opener-unavailable' }
    }
    const launch = async (argv: readonly string[]) => {
      const handle = this.subprocess.spawn({
        argv,
        cwd: this.cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 4_096 },
          stderr: { maxBytes: 4_096 },
        },
        graceMs: 1_000,
      })
      return handle.done
    }

    const appBundleId = preferredBundleId(episode)
    if (appBundleId) {
      const preferred = await launch([opener, '-b', appBundleId, target])
      if (preferred.exitCode === 0) {
        return {
          status: 'opened',
          appBundleId,
          kind: resource.kind,
        }
      }

      // The stored app identity is a preference, not a reason to strand the
      // user. The target has already passed the stored-evidence and scheme
      // checks above, so retrying with LaunchServices' default handler does not
      // broaden what the browser can ask the Host to open.
      const fallback = await launch([opener, target])
      if (fallback.exitCode === 0) {
        return { status: 'opened', kind: resource.kind }
      }
      throw new ResumeOpenLaunchError('resource opener failed')
    }

    const outcome = await launch([opener, target])
    if (outcome.exitCode !== 0) {
      throw new ResumeOpenLaunchError('resource opener failed')
    }
    return { status: 'opened', kind: resource.kind }
  }
}
