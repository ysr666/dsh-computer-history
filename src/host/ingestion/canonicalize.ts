import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import {
  fileURLToPath,
  pathToFileURL,
} from 'node:url'
import type {
  ResourceIdentity,
} from '../../shared/index.js'

async function unresolvedSymlinkInPath(filePath: string): Promise<boolean> {
  const parsed = path.parse(filePath)
  const segments = filePath
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)

  const inspect = async (
    current: string,
    index: number,
  ): Promise<boolean> => {
    if (index >= segments.length) return false
    const next = path.join(current, segments[index]!)
    try {
      if ((await lstat(next)).isSymbolicLink()) return true
      return inspect(next, index + 1)
    } catch (error) {
      const code = error instanceof Error
        && 'code' in error
        ? String(error.code)
        : undefined
      if (code === 'ENOENT' || code === 'ENOTDIR') return false
      return true
    }
  }

  return inspect(parsed.root, 0)
}

export async function canonicalizeResource(
  resource: ResourceIdentity | undefined,
): Promise<ResourceIdentity | undefined> {
  if (!resource) return undefined
  if (!resource.canonicalUri.startsWith('file://')) {
    return resource
  }

  let filePath: string
  try {
    filePath = fileURLToPath(resource.canonicalUri)
  } catch {
    return undefined
  }

  let canonicalPath = path.resolve(filePath)
  try {
    canonicalPath = await realpath(canonicalPath)
  } catch {
    // A plain missing path can retain a weak normalized identity. If an
    // existing prefix is a symlink, however, the canonical target is
    // unknown; fail closed rather than persist a potentially protected
    // resource under an alias.
    if (await unresolvedSymlinkInPath(canonicalPath)) {
      return undefined
    }
  }

  return {
    ...resource,
    canonicalUri: pathToFileURL(canonicalPath).href,
  }
}
