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
    getWorkspaceFolder(uri: Uri): WorkspaceFolder | undefined
    getConfiguration(section: string): WorkspaceConfiguration
    onDidChangeWorkspaceFolders(listener: () => void): Disposable
  }

  export interface OutputChannel {
    appendLine(value: string): void
  }

  export interface Window {
    createOutputChannel(name: string): OutputChannel
    readonly activeTextEditor: TextEditor | undefined
    readonly activeTerminal: Terminal | undefined
    onDidChangeActiveTextEditor(listener: () => void): Disposable
    onDidChangeActiveTerminal(listener: () => void): Disposable
  }

  export interface SecretStorage {
    get(key: string): Promise<string | undefined>
    store(key: string, value: string): Promise<void>
  }

  export interface Memento {
    get<T>(key: string): T | undefined
    update(key: string, value: unknown): Promise<void>
  }

  export interface ExtensionContext {
    readonly subscriptions: Disposable[]
    readonly secrets: SecretStorage
    readonly globalState: Memento
  }

  export interface Env {
    readonly appName: string
    readonly appHost: string
  }

  export const workspace: Workspace
  export const window: Window
  export const env: Env
}

// The extension needs one function from node at runtime, and this declaration is
// cheaper than adding a type dependency to a package that has none.
declare function require(name: string): unknown

declare const process: {
  readonly platform: string
  getuid?: () => number
}
