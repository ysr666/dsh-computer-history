import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import type { ResourceIdentity } from '../../src/shared/index.js'
import { DshWorkspaceResolver } from '../../src/host/workspace-resolver.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function tempTree(): {
  root: string
  nested: string
} {
  const created = mkdtempSync(
    path.join(os.tmpdir(), 'dsh-ch-workspace-'),
  )
  roots.push(created)
  const root = realpathSync(created)
  const nested = path.join(root, 'src')
  mkdirSync(nested)
  return { root, nested }
}

function fileResource(
  filePath: string,
): ResourceIdentity {
  return {
    kind: 'file',
    canonicalUri: pathToFileURL(filePath).href,
  }
}

function context(options: {
  exact?: {
    id: string
    path: string
    title: string
  }
  listed?: readonly {
    id: string
    path: string
    title: string
  }[]
  gitRoot?: string
  gitExitCode?: number
  onSpawn?: (spec: unknown) => void
}): Context {
  const workspaceRegistry = {
    resolveByPath: async () => options.exact,
    list: () => options.listed ?? [],
  }
  const subprocess = {
    spawn: (spec: unknown) => {
      options.onSpawn?.(spec)
      const text = options.gitRoot
        ? options.gitRoot + '\n'
        : ''
      return {
        done: Promise.resolve({
          exitCode: options.gitExitCode ?? 0,
          signal: null,
        }),
        collected: {
          stdout: {
            readFrom: () => ({
              text,
              nextOffset: Buffer.byteLength(text),
              lossy: false,
            }),
          },
        },
      }
    },
  }
  return {
    workspaceRegistry,
    subprocess,
  } as unknown as Context
}

describe('DSH workspace resolver', () => {
  it('uses an exact registered DSH workspace first', async () => {
    const { root } = tempTree()
    const resolver = new DshWorkspaceResolver(context({
      exact: { id: 'alpha', path: root, title: 'Alpha' },
    }))

    await expect(resolver.resolve({
      kind: 'directory',
      canonicalUri: pathToFileURL(root).href,
    })).resolves.toEqual({
      id: 'alpha',
      root,
      title: 'Alpha',
      source: 'dsh',
      confidence: 1,
    })
  })

  it('matches a nested resource to the deepest registered workspace', async () => {
    const { root, nested } = tempTree()
    const child = path.join(root, 'packages', 'child')
    mkdirSync(path.dirname(child), { recursive: true })
    mkdirSync(child)
    const resolver = new DshWorkspaceResolver(context({
      listed: [
        { id: 'root', path: root, title: 'Root' },
        { id: 'child', path: child, title: 'Child' },
      ],
      gitExitCode: 1,
    }))

    await expect(resolver.resolve(
      fileResource(path.join(nested, 'provider.ts')),
    )).resolves.toEqual({
      id: 'root',
      root,
      title: 'Root',
      source: 'dsh',
      confidence: 0.95,
    })
  })

  it('uses bounded git rev-parse as the strong fallback', async () => {
    const { root, nested } = tempTree()
    let spawnSpec: unknown
    let spawnCount = 0
    const resolver = new DshWorkspaceResolver(context({
      gitRoot: root,
      onSpawn: spec => {
        spawnSpec = spec
        spawnCount += 1
      },
    }))
    const resource = fileResource(
      path.join(nested, 'provider.ts'),
    )

    await expect(resolver.resolve(resource)).resolves.toEqual({
      root,
      title: path.basename(root),
      source: 'git',
      confidence: 0.85,
    })
    await expect(resolver.resolve(resource)).resolves.toMatchObject({
      source: 'git',
      root,
    })
    expect(spawnCount).toBe(1)
    expect(spawnSpec).toMatchObject({
      argv: [
        'git',
        '-C',
        nested,
        'rev-parse',
        '--show-toplevel',
      ],
      cwd: nested,
      stdio: {
        stdin: 'ignore',
      },
    })
  })

  it('falls back weakly to the filesystem directory without creating a workspace', async () => {
    const { nested } = tempTree()
    const resolver = new DshWorkspaceResolver(context({
      gitExitCode: 1,
    }))

    await expect(resolver.resolve(
      fileResource(path.join(nested, 'provider.ts')),
    )).resolves.toEqual({
      root: nested,
      title: path.basename(nested),
      source: 'filesystem',
      confidence: 0.4,
    })
  })
})
