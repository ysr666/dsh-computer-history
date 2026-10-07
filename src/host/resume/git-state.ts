import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-subprocess'

const CHECKPOINT_GIT_TIMEOUT_MS = 250

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
