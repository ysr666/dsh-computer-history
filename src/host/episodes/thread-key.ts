import type { WorkspaceRef } from '../../shared/index.js'

export function threadKeyForWorkspace(
  workspace: WorkspaceRef,
): string | undefined {
  if (workspace.source === 'dsh' && workspace.id) {
    return `workspace:${workspace.id}`
  }

  if (workspace.source === 'git' && workspace.root) {
    return `git:${workspace.root}`
  }

  return undefined
}
