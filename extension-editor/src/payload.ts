/**
 * The wire payload (ADR 0009), built from editor metadata only.
 *
 * This module is deliberately free of the `vscode` API so it can be tested
 * directly, and it has no parameter a document body, a selection or a UI string
 * could be passed through: the shape is the guarantee, not the caller's
 * discipline. A guard test asserts that this file and `extension.ts` never
 * mention the text-reading APIs at all.
 */
/**
 * Which application this extension speaks for (ADR 0011).
 *
 * The editor knows its own product name; it does not know the operating system's
 * bundle id. Known products map to the id the OS and the allow-list use, and
 * anything else becomes a readable id of its own - so a new editor works without
 * a Host release, and the user decides whether to allow it like any other
 * application.
 */
export function declaredIdentity(appName: string): { bundleId: string, name: string } {
  const known: Record<string, string> = {
    'visual studio code': 'com.microsoft.VSCode',
    'visual studio code - insiders': 'com.microsoft.VSCodeInsiders',
    cursor: 'com.todesktop.230313mzl4w4u92',
    windsurf: 'com.exafunction.windsurf',
  }
  const trimmed = appName.trim()
  const bundleId = known[trimmed.toLowerCase()]
  if (bundleId !== undefined) return { bundleId, name: trimmed }
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return {
    bundleId: `com.dsh.editor.${slug === '' ? 'unknown' : slug}`.slice(0, 128),
    name: trimmed === '' ? 'Unknown editor' : trimmed,
  }
}

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
  readonly app: { readonly bundleId: string, readonly name: string }
  readonly editorSession: string
  readonly seq: number
  readonly observedAtMs: number
}

export function buildEditorPayload(input: {
  readonly metadata: EditorMetadata
  readonly identity: { readonly bundleId: string, readonly name: string }
  readonly session: string
  readonly seq: number
  readonly observedAtMs: number
}): EditorObservationPayload {
  return {
    source: 'editor',
    app: input.identity,
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
