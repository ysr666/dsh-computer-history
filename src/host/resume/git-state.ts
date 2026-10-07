import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-subprocess'
import type {
  ResumeGitFile,
  ResumeGitState,
  ResumeHandoff,
} from '../../shared/index.js'

const GIT_TIMEOUT_MS = 1_000
const CHECKPOINT_GIT_TIMEOUT_MS = 250
const GIT_OUTPUT_BYTES = 32 * 1_024
const MAX_CHANGED_FILES = 24

function statusFile(line: string): ResumeGitFile | undefined {
  if (line.startsWith('? ')) {
    const filePath = line.slice(2).trim()
    return filePath === '' ? undefined : { path: filePath, status: '??' }
  }
  if (line.startsWith('! ')) return undefined

  const kind = line[0]
  if (kind !== '1' && kind !== '2' && kind !== 'u') return undefined
  const fields = line.split(' ')
  const status = fields[1]
  if (!status || status.length !== 2) return undefined

  // Porcelain v2 puts the path after a fixed metadata prefix. A rename/copy
  // record may append the original path after a tab; the current path is the
  // actionable resource and is all a handoff needs.
  const prefixFields = kind === '2' ? 9 : kind === 'u' ? 10 : 8
  const filePath = fields.slice(prefixFields).join(' ').split('\t')[0]?.trim()
  return filePath ? { path: filePath, status } : undefined
}

/** Read only the repository HEAD for a DSH checkpoint; never scan the worktree. */
export async function probeCheckpointGitHead(
  ctx: Context,
  workspaceRoot: string,
): Promise<string | undefined> {
  if (!path.isAbsolute(workspaceRoot)) return undefined
  const signal = AbortSignal.timeout(CHECKPOINT_GIT_TIMEOUT_MS)
  let handle
  try {
    handle = ctx.subprocess.spawn({
      argv: ['git', '-C', workspaceRoot, 'rev-parse', '--verify', 'HEAD'],
      cwd: workspaceRoot,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 256 },
        stderr: { maxBytes: 512 },
      },
      graceMs: 100,
      signal,
    })
  } catch {
    return undefined
  }

  try {
    const outcome = await handle.done
    if (outcome.exitCode !== 0 || signal.aborted) return undefined
    const value = handle.collected.stdout?.readFrom(0)?.text.trim() ?? ''
    return /^[0-9a-f]{40,64}$/i.test(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Read repository shape only: branch, HEAD and changed file names/status codes.
 * No diff, blob, file body or commit message is requested.
 */
export async function probeResumeGitState(
  ctx: Context,
  workspaceRoot: string,
  now: () => number = Date.now,
): Promise<ResumeGitState | undefined> {
  if (!path.isAbsolute(workspaceRoot)) return undefined

  const signal = AbortSignal.timeout(GIT_TIMEOUT_MS)
  let handle
  try {
    handle = ctx.subprocess.spawn({
      argv: [
        'git', '-C', workspaceRoot,
        'status', '--porcelain=v2', '--branch', '--untracked-files=normal',
      ],
      cwd: workspaceRoot,
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
    if (outcome.exitCode !== 0 || signal.aborted) return undefined
    const output = handle.collected.stdout?.readFrom(0)
    if (!output) return undefined

    let head: string | undefined
    let branch: string | undefined
    const changedFiles: ResumeGitFile[] = []
    let changedCount = 0

    for (const line of output.text.split(/\r?\n/)) {
      if (line.startsWith('# branch.oid ')) {
        const value = line.slice('# branch.oid '.length).trim()
        if (value !== '' && value !== '(initial)') head = value
        continue
      }
      if (line.startsWith('# branch.head ')) {
        const value = line.slice('# branch.head '.length).trim()
        if (value !== '' && value !== '(detached)') branch = value
        continue
      }
      if (line.startsWith('# ')) continue

      const file = statusFile(line)
      if (!file) continue
      changedCount += 1
      if (changedFiles.length < MAX_CHANGED_FILES) changedFiles.push(file)
    }

    return {
      observedAtMs: now(),
      ...(branch === undefined ? {} : { branch }),
      ...(head === undefined ? {} : { head }),
      dirty: changedCount > 0,
      changedFiles,
      truncated: output.lossy || changedCount > changedFiles.length,
    }
  } catch {
    return undefined
  }
}

export async function enrichResumeHandoff(
  ctx: Context,
  handoff: ResumeHandoff,
): Promise<ResumeHandoff> {
  if (handoff.status !== 'hit') return handoff
  const root = handoff.workspace?.root
  if (!root) return handoff
  const git = await probeResumeGitState(ctx, root)
  return git === undefined ? handoff : { ...handoff, git }
}
