import * as vscode from 'vscode'

/**
 * One place to say what the companion is doing. Set during activation, used by the
 * send path as well - a guard in another function that returns in silence is
 * indistinguishable from an extension that never started.
 */
let reporter: ((message: string) => void) | undefined

function report(message: string): void {
  reporter?.(message)
}

import {
  buildEditorPayload,
  declaredIdentity,
  surfaceKindOf,
  type EditorMetadata,
} from './payload'

/**
 * The editor companion (ADR 0009).
 *
 * It reads exactly three things from the editor: the workspace folder paths, the
 * active document's **path** and **language id**, and whether the view is a diff
 * or a terminal. It never calls `getText`, never looks at a selection, and never
 * reads a line of the document. Unpaired means nothing is sent at all.
 */
let seq = 0
const session = `vscode-${Date.now().toString(36)}`

function config(): { port: number, token: string } {

  const settings = vscode.workspace.getConfiguration('dshComputerHistory')
  const { appendFileSync } = require('node:fs') as {
    appendFileSync: (file: string, data: string) => void
  }
  const channel = vscode.window.createOutputChannel('Computer History')
  const traceFile = (settings.get<string>('traceFile') ?? '').trim()
  // Every decision is reported. A guard that returns in silence looks exactly like
  // an extension that never started - which is what made an earlier run of this
  // companion impossible to diagnose from outside.
  const say = (message: string): void => {
    const line = `${new Date().toISOString()} ${message}`
    channel.appendLine(line)
    if (traceFile !== '') {
      try {
        appendFileSync(traceFile, `${line}\n`)
      } catch {
        // A trace file that cannot be written must not break the extension.
      }
    }
  }
  reporter = say
  say(`activated: appName=${vscode.env.appName} host=${vscode.env.appHost}`)
  return {
    port: settings.get<number>('port') ?? 19388,
    token: (settings.get<string>('token') ?? '').trim(),
  }
}

function metadataOf(): EditorMetadata | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) return undefined
  const editor = vscode.window.activeTextEditor
  const filePath = editor?.document.uri.scheme === 'file'
    ? editor.document.uri.fsPath
    : undefined
  return {
    workspaceRoot: folder.uri.fsPath,
    ...(filePath === undefined ? {} : { filePath }),
    ...(filePath === undefined || editor === undefined
      ? {}
      : { languageId: editor.document.languageId }),
    surfaceKind: surfaceKindOf({
      isDiff: editor?.document.uri.scheme === 'git',
      isTerminal: vscode.window.activeTerminal !== undefined && editor === undefined,
    }),
    ...(filePath === undefined
      ? {}
      : { title: filePath.split('/').pop() ?? filePath }),
  }
}

async function send(): Promise<void> {
  const { port, token } = config()
  // Fail closed: without a token the Host would answer 401 anyway, and not
  // building the request at all keeps the failure obvious.
  if (token === '') {
      report('not sending: no token configured')
    return
  }
  const metadata = metadataOf()
  if (!metadata) {
      report('not sending: no workspace folder or no file in the editor')
    return
  }

  seq += 1
  try {
    await fetch(`http://127.0.0.1:${port}/companion/observation`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-companion-token': token,
      },
      body: JSON.stringify(buildEditorPayload({
        metadata,
        // What this extension says it is: the product the editor reports about
        // itself, so one package serves every VS Code-based editor.
        identity: declaredIdentity(vscode.env.appName),
        session,
        seq,
        observedAtMs: Date.now(),
      })),
    })
  } catch {
    // The Host may be down; the editor must not care.
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => { void send() }),
    vscode.window.onDidChangeActiveTerminal(() => { void send() }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void send() }),
  )
  void send()
}

export function deactivate(): void {}
