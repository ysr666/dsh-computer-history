export type WorkspaceSource =
  | 'dsh'
  | 'git'
  | 'filesystem'
  | 'none'

export interface WorkspaceRef {
  readonly id?: string
  readonly root?: string
  readonly title?: string
  readonly source: WorkspaceSource
  readonly confidence: number
}
