/**
 * The slice of the VS Code API this extension uses, declared so the package
 * compiles outside the editor. It is a stub for type-checking only: at runtime
 * `vscode` is provided by the editor. Keeping the surface this small also keeps
 * the review honest - if a future change needs another API, it shows up here.
 */
declare module 'vscode' {
  export interface Uri {
    readonly scheme: string
    readonly fsPath: string
  }
  export interface TextDocument {
    readonly uri: Uri
    readonly languageId: string
  }
  export interface TextEditor {
    readonly document: TextDocument
  }
  export interface WorkspaceFolder {
    readonly uri: Uri
  }
  export interface Terminal {}

  export interface Disposable {
    dispose(): void
  }

  export interface WorkspaceConfiguration {
    get<T>(section: string): T | undefined
  }

  export interface Workspace {
    readonly workspaceFolders: readonly WorkspaceFolder[] | undefined
    getConfiguration(section: string): WorkspaceConfiguration
    onDidChangeWorkspaceFolders(listener: () => void): Disposable
  }

  export interface Window {
    readonly activeTextEditor: TextEditor | undefined
    readonly activeTerminal: Terminal | undefined
    onDidChangeActiveTextEditor(listener: () => void): Disposable
    onDidChangeActiveTerminal(listener: () => void): Disposable
  }

  export interface ExtensionContext {
    readonly subscriptions: Disposable[]
  }

  export const workspace: Workspace
  export const window: Window
}
