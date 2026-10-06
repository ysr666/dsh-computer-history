import * as vscode from 'vscode'
import {
  buildEditorPayload,
  declaredIdentity,
  surfaceKindOf,
  type EditorMetadata,
} from './payload'

let reporter: ((message: string) => void) | undefined
let seq = 0
const session = `vscode-${crypto.randomUUID()}`
const TOKEN_SECRET = 'companionToken'
const PORT_STATE = 'companionPort'
const DEFAULT_PORT = 19388
const BOOTSTRAP_FILENAME = 'editor-companion-bootstrap.json'

type Bootstrap = {
  readonly v: 1
  readonly port: number
  readonly token: string
  readonly expiresAtMs: number
}

function report(message: string): void {
  reporter?.(message)
}

function installReporter(): void {
  const settings = vscode.workspace.getConfiguration('dshComputerHistory')
  const fs = require('node:fs') as {
    appendFileSync: (file: string, data: string) => void
  }
  const os = require('node:os') as { homedir: () => string }
  const channel = vscode.window.createOutputChannel('Computer History')
  const configuredTrace = (settings.get<string>('traceFile') ?? '').trim()
  const traceFile = configuredTrace !== ''
    ? configuredTrace
    : `${os.homedir()}/.dsh/computer-history-editor.log`
  reporter = (message: string): void => {
    const line = `${new Date().toISOString()} ${message}`
    channel.appendLine(line)
    try {
      fs.appendFileSync(traceFile, `${line}\n`)
    } catch {
      // Diagnostics must never affect recording.
    }
  }
  report(`activated: appName=${vscode.env.appName} host=${vscode.env.appHost}`)
}

function bootstrapPath(): string {
  const os = require('node:os') as { homedir: () => string }
  const path = require('node:path') as { join: (...parts: string[]) => string }
  return path.join(
    os.homedir(),
    '.dsh',
    'computer-history',
    BOOTSTRAP_FILENAME,
  )
}

function pendingBootstrap(): { readonly path: string; readonly value: Bootstrap } | undefined {
  const fs = require('node:fs') as {
    readFileSync: (file: string, encoding: 'utf8') => string
    statSync: (file: string) => { readonly mode: number; readonly uid: number }
    unlinkSync: (file: string) => void
  }
  const target = bootstrapPath()
  try {
    const stat = fs.statSync(target)
    if (
      process.platform !== 'win32'
      && ((stat.mode & 0o077) !== 0
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid()))
    ) {
      report('bootstrap ignored: unsafe owner or permissions')
      return undefined
    }
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as Partial<Bootstrap>
    if (
      parsed.v !== 1
      || !Number.isInteger(parsed.port)
      || Number(parsed.port) < 1
      || Number(parsed.port) > 65_535
      || typeof parsed.token !== 'string'
      || parsed.token.length < 32
      || typeof parsed.expiresAtMs !== 'number'
    ) {
      report('bootstrap ignored: invalid shape')
      fs.unlinkSync(target)
      return undefined
    }
    if (parsed.expiresAtMs < Date.now()) {
      report('bootstrap ignored: expired')
      fs.unlinkSync(target)
      return undefined
    }
    return {
      path: target,
      value: parsed as Bootstrap,
    }
  } catch {
    return undefined
  }
}

async function credentials(
  context: vscode.ExtensionContext,
): Promise<{ readonly port: number; readonly token: string }> {
  const fs = require('node:fs') as { unlinkSync: (file: string) => void }
  const bootstrap = pendingBootstrap()
  if (bootstrap) {
    await context.secrets.store(TOKEN_SECRET, bootstrap.value.token)
    await context.globalState.update(PORT_STATE, bootstrap.value.port)
    try { fs.unlinkSync(bootstrap.path) } catch {}
    report('automatic pairing bootstrap consumed')
    return { port: bootstrap.value.port, token: bootstrap.value.token }
  }

  const storedToken = (await context.secrets.get(TOKEN_SECRET))?.trim() ?? ''
  const storedPort = context.globalState.get<number>(PORT_STATE) ?? DEFAULT_PORT
  if (storedToken !== '') return { port: storedPort, token: storedToken }

  // One-time migration for development installs that previously stored the
  // credential in visible editor settings. Those settings are no longer
  // contributed, but an existing value can still be read and moved to SecretStorage.
  const legacy = vscode.workspace.getConfiguration('dshComputerHistory')
  const legacyToken = (legacy.get<string>('token') ?? '').trim()
  const legacyPort = legacy.get<number>('port') ?? DEFAULT_PORT
  if (legacyToken !== '') {
    await context.secrets.store(TOKEN_SECRET, legacyToken)
    await context.globalState.update(PORT_STATE, legacyPort)
    report('legacy pairing settings migrated to SecretStorage')
    return { port: legacyPort, token: legacyToken }
  }

  return { port: DEFAULT_PORT, token: '' }
}

function metadataOf(): EditorMetadata | undefined {
  const editor = vscode.window.activeTextEditor
  const folder = editor
    ? vscode.workspace.getWorkspaceFolder(editor.document.uri)
    : vscode.workspace.workspaceFolders?.[0]
  if (!folder) return undefined
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
      : { title: filePath.split(/[\\/]/).pop() ?? filePath }),
  }
}

async function send(context: vscode.ExtensionContext): Promise<void> {
  const { port, token } = await credentials(context)
  if (token === '') {
    report('not sending: waiting for automatic pairing')
    return
  }
  const metadata = metadataOf()
  if (!metadata) {
    report('not sending: no workspace folder or no file in the editor')
    return
  }

  seq += 1
  try {
    const response = await fetch(`http://127.0.0.1:${port}/companion/observation`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-companion-token': token,
      },
      body: JSON.stringify(buildEditorPayload({
        metadata,
        identity: declaredIdentity(vscode.env.appName),
        session,
        seq,
        observedAtMs: Date.now(),
      })),
    })
    if (response.status === 202) {
      let delivery: { readonly stored?: unknown; readonly reason?: unknown } | undefined
      try {
        delivery = await response.json() as {
          readonly stored?: unknown
          readonly reason?: unknown
        }
      } catch {
        delivery = undefined
      }
      if (delivery?.stored === false) {
        report(
          `send not stored: ${
            typeof delivery.reason === 'string'
              ? delivery.reason
              : 'policy-or-duplicate'
          }`,
        )
      } else {
        report('send not stored: Host answered HTTP 202')
      }
    } else if (!response.ok) {
      report(`send rejected: HTTP ${response.status}`)
    }
  } catch {
    // The Host may be down; recording in the editor must keep working independently,
    // but the extension's own diagnostics must not pretend the send succeeded.
    report('send failed: Host unavailable')
  }
}

export function activate(context: vscode.ExtensionContext): void {
  installReporter()
  const fs = require('node:fs') as {
    watchFile: (file: string, options: { interval: number }, listener: () => void) => void
    unwatchFile: (file: string, listener: () => void) => void
  }
  const bootstrap = bootstrapPath()
  const onBootstrapChanged = (): void => { void send(context) }
  fs.watchFile(bootstrap, { interval: 1_000 }, onBootstrapChanged)

  context.subscriptions.push(
    { dispose: () => { fs.unwatchFile(bootstrap, onBootstrapChanged) } },
    vscode.window.onDidChangeActiveTextEditor(() => { void send(context) }),
    vscode.window.onDidChangeActiveTerminal(() => { void send(context) }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void send(context) }),
  )
  void send(context)
}

export function deactivate(): void {}
