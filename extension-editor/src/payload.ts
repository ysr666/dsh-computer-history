/**
 * The wire payload (ADR 0009), built from editor metadata only.
 *
 * This module is deliberately free of the `vscode` API so it can be tested
 * directly, and it has no parameter a document body, a selection or a UI string
 * could be passed through: the shape is the guarantee, not the caller's
 * discipline. A guard test asserts that this file and `extension.ts` never
 * mention the text-reading APIs at all.
 */
export interface EditorMetadata {
  /** Absolute path of the workspace folder the editor vouches for. */
  readonly workspaceRoot: string
  /** Absolute path of the active file, when there is one. */
  readonly filePath?: string
  readonly languageId?: string
  readonly surfaceKind?: 'editor' | 'diff' | 'terminal' | 'output'
  readonly title?: string
}

export interface EditorObservationPayload extends EditorMetadata {
  readonly source: 'editor'
  readonly editorSession: string
  readonly seq: number
  readonly observedAtMs: number
}

export function buildEditorPayload(input: {
  readonly metadata: EditorMetadata
  readonly session: string
  readonly seq: number
  readonly observedAtMs: number
}): EditorObservationPayload {
  return {
    source: 'editor',
    workspaceRoot: input.metadata.workspaceRoot,
    ...(input.metadata.filePath === undefined ? {} : { filePath: input.metadata.filePath }),
    ...(input.metadata.languageId === undefined ? {} : { languageId: input.metadata.languageId }),
    ...(input.metadata.surfaceKind === undefined ? {} : { surfaceKind: input.metadata.surfaceKind }),
    ...(input.metadata.title === undefined ? {} : { title: input.metadata.title }),
    editorSession: input.session,
    seq: input.seq,
    observedAtMs: input.observedAtMs,
  }
}

/** The surface kind an editor can report about its own active view. */
export function surfaceKindOf(input: {
  readonly isDiff: boolean
  readonly isTerminal: boolean
}): EditorMetadata['surfaceKind'] {
  if (input.isTerminal) return 'terminal'
  if (input.isDiff) return 'diff'
  return 'editor'
}
