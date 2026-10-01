import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-workspace'
import type { WorkspaceRef } from '../shared/index.js'
import type { WorkspaceResolver } from './ingestion/index.js'

export class DshWorkspaceResolver implements WorkspaceResolver {
  public constructor(private readonly ctx: Context) {}

  public async resolve(resourceUri: string | undefined): Promise<WorkspaceRef> {
    if (!resourceUri) return { source: 'none', confidence: 0 }
    let filePath: string
    try {
      if (resourceUri.startsWith('file://')) filePath = fileURLToPath(resourceUri)
      else if (resourceUri.startsWith('/')) filePath = resourceUri
      else return { source: 'none', confidence: 0 }
    } catch {
      return { source: 'none', confidence: 0 }
    }

    const candidates = this.ctx.workspaceRegistry.list()
      .filter(workspace =>
        filePath === workspace.path
        || filePath.startsWith(workspace.path.endsWith('/') ? workspace.path : workspace.path + '/'),
      )
      .toSorted((left, right) => right.path.length - left.path.length)

    const workspace = candidates[0]
    if (!workspace) return { source: 'filesystem', root: filePath, confidence: 0.2 }
    return {
      id: String(workspace.id),
      root: workspace.path,
      title: workspace.title,
      source: 'dsh',
      confidence: 1,
    }
  }
}
