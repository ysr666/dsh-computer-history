import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ResumeHandoff } from '../shared/index.js'

function canonicalMetadataPath(value: string): string {
  try {
    return realpathSync.native(value)
  } catch {
    return path.resolve(value)
  }
}

export function gitPathForResource(
  handoff: Extract<ResumeHandoff, { status: 'hit' }>,
  canonicalUri: string,
): string | undefined {
  const root = handoff.workspace?.root
  if (!root || !canonicalUri.startsWith('file:')) return undefined
  try {
    const absolute = fileURLToPath(canonicalUri)
    const canonicalRoot = canonicalMetadataPath(root)
    const canonicalAbsolute = canonicalMetadataPath(absolute)
    const relative = path.relative(canonicalRoot, canonicalAbsolute)
    if (
      relative === ''
      || relative.startsWith('..' + path.sep)
      || relative === '..'
      || path.isAbsolute(relative)
    ) return undefined
    return relative.split(path.sep).join('/')
  } catch {
    return undefined
  }
}
