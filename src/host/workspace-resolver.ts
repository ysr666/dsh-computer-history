import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-subprocess'
import '@deepseek-ai/dsh-workspace'
import type {
  ResourceIdentity,
  WorkspaceRef,
} from '../shared/index.js'
import type { WorkspaceResolver } from './ingestion/index.js'

const GIT_TIMEOUT_MS = 1_000
const GIT_OUTPUT_BYTES = 4_096
const FALLBACK_CACHE_MS = 30_000
const FALLBACK_CACHE_MAX_ENTRIES = 256

function resourceDirectory(
  resource: ResourceIdentity | undefined,
): string | undefined {
  if (!resource || resource.kind === 'url') return undefined

  let value: string
  try {
    value = resource.canonicalUri.startsWith('file://')
      ? fileURLToPath(resource.canonicalUri)
      : resource.canonicalUri
  } catch {
    return undefined
  }

  if (!path.isAbsolute(value)) return undefined
  if (
    resource.kind === 'directory'
    || resource.kind === 'workspace'
  ) {
    return path.resolve(value)
  }
  return path.dirname(path.resolve(value))
}

function asWorkspaceRef(
  workspace: {
    readonly id: unknown
    readonly path: string
    readonly title: string
  },
  confidence: number,
): WorkspaceRef {
  return {
    id: String(workspace.id),
    root: workspace.path,
    title: workspace.title,
    source: 'dsh',
    confidence,
  }
}

function pathTitle(value: string): string {
  return path.basename(value) || value
}

export class DshWorkspaceResolver
implements WorkspaceResolver {
  private readonly fallbackCache = new Map<string, {
    readonly expiresAtMs: number
    readonly workspace: WorkspaceRef
  }>()

  public constructor(private readonly ctx: Context) {}

  public async resolve(
    resource: ResourceIdentity | undefined,
  ): Promise<WorkspaceRef> {
    const rawDirectory = resourceDirectory(resource)
    if (!rawDirectory) {
      return { source: 'none', confidence: 0 }
    }

    let directory = rawDirectory
    try {
      directory = await realpath(rawDirectory)
    } catch {
      // Deleted/nonexistent resources remain weakly addressable.
    }

    const registered =
      await this.registeredWorkspace(directory)
    if (registered) return registered

    const nowMs = Date.now()
    const cached = this.fallbackCache.get(directory)
    if (cached && cached.expiresAtMs > nowMs) {
      return cached.workspace
    }
    if (cached) this.fallbackCache.delete(directory)

    const gitRoot = await this.resolveGitRoot(directory)
    const workspace: WorkspaceRef = gitRoot
      ? {
          root: gitRoot,
          title: pathTitle(gitRoot),
          source: 'git',
          confidence: 0.85,
        }
      : {
          root: directory,
          title: pathTitle(directory),
          source: 'filesystem',
          confidence: 0.4,
        }

    if (
      !this.fallbackCache.has(directory)
      && this.fallbackCache.size >= FALLBACK_CACHE_MAX_ENTRIES
    ) {
      const oldest = this.fallbackCache.keys().next().value
      if (oldest !== undefined) this.fallbackCache.delete(oldest)
    }
    this.fallbackCache.set(directory, {
      expiresAtMs: nowMs + FALLBACK_CACHE_MS,
      workspace,
    })
    return workspace
  }

  private async registeredWorkspace(
    directory: string,
  ): Promise<WorkspaceRef | undefined> {
    try {
      const exact =
        await this.ctx.workspaceRegistry.resolveByPath(
          directory,
        )
      if (exact) return asWorkspaceRef(exact, 1)
    } catch {
      // Missing paths cannot be canonicalized by the registry.
    }

    const candidate = this.ctx.workspaceRegistry.list()
      .filter(workspace =>
        directory === workspace.path
        || directory.startsWith(
          workspace.path.endsWith(path.sep)
            ? workspace.path
            : workspace.path + path.sep,
        ),
      )
      .toSorted((left, right) =>
        right.path.length - left.path.length,
      )[0]

    return candidate
      ? asWorkspaceRef(candidate, 0.95)
      : undefined
  }

  private async resolveGitRoot(
    directory: string,
  ): Promise<string | undefined> {
    const signal = AbortSignal.timeout(GIT_TIMEOUT_MS)
    let handle
    try {
      handle = this.ctx.subprocess.spawn({
        argv: [
          'git',
          '-C',
          directory,
          'rev-parse',
          '--show-toplevel',
        ],
        cwd: directory,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: GIT_OUTPUT_BYTES },
          stderr: { maxBytes: 1_024 },
        },
        graceMs: 500,
        signal,
      })
    } catch {
      return undefined
    }

    try {
      const outcome = await handle.done
      if (outcome.exitCode !== 0 || signal.aborted) {
        return undefined
      }
      const output = handle.collected.stdout?.readFrom(0)
      if (!output || output.lossy) return undefined

      const lines = output.text.trim().split(/\r?\n/)
      if (lines.length !== 1) return undefined
      const root = lines[0]
      if (!root || !path.isAbsolute(root)) return undefined

      try {
        return await realpath(root)
      } catch {
        return undefined
      }
    } catch {
      return undefined
    }
  }
}
