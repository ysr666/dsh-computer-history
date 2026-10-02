export type WorkspaceSource =
  | 'dsh'
  | 'git'
  | 'filesystem'
  /** Vouched for by a paired companion, not inferred (ADR 0009). */
  | 'companion'
  | 'none'

export interface WorkspaceRef {
  readonly id?: string
  readonly root?: string
  readonly title?: string
  readonly source: WorkspaceSource
  readonly confidence: number
}
