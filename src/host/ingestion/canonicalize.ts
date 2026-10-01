import { realpath } from 'node:fs/promises'
import path from 'node:path'
import {
  fileURLToPath,
  pathToFileURL,
} from 'node:url'
import type {
  ResourceIdentity,
} from '../../shared/index.js'

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
    // Deleted/nonexistent files keep a normalized absolute identity.
  }

  return {
    ...resource,
    canonicalUri: pathToFileURL(canonicalPath).href,
  }
}
