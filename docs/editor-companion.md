# Editor companion

The editor companion tells the Host where work is happening. It exists because
the operating system's accessibility layer cannot vouch for a workspace: an
Accessibility observation can only guess from a document path, which is why
Phase 2.3 had "unanchored" episodes. The editor knows, so the Host asks.

Same trust boundary as the browser companion (ADR 0007 / ADR 0009): a loopback
listener the plugin owns, a pairing token stored as a digest, `incognito`-style
fail-closed behaviour, and per-workspace consent through the existing `resource`
policy dimension. No new trusted concept.

## What it sends, and what it cannot send

| sent | source in the editor |
|---|---|
| `workspaceRoot` | the workspace that owns the active document (`workspace.getWorkspaceFolder(...)`); the sole/fallback folder only when no editor is active |
| `filePath` | `window.activeTextEditor.document.uri.fsPath` |
| `languageId` | `document.languageId` |
| `surfaceKind` | active view: editor, diff, terminal |
| `title` | the file's base name |\n| `event` | `save`, or a bounded build/test/other success/failure fact from VS Code Tasks |
| `event` | optional closed metadata event; currently only `save`, from `onDidSaveTextDocument` |

Not sent, and **not expressible**: document text, selections, diagnostics, UI
strings, task names, task sources, command lines, or task output. Verification
records only the standard task group (`build`, `test`, or `other`) and whether
its process succeeded or failed; terminated tasks with no exit code are not
reported. The payload shape has no field for content, the Host refuses unknown
fields instead of ignoring them, and guard tests reject text-reading APIs and
task-text/command access.

## Install and pair

The normal macOS flow is **Settings → VS Code companion → Install and connect**.
The Host installs only the bundled VSIX with a fixed `code --install-extension`
argv, creates an editor-specific pairing credential, and stages it for up to five
minutes in a user-only `0600` bootstrap file. The extension consumes that file,
moves the token into VS Code `SecretStorage`, stores the loopback port in extension
state, and deletes the bootstrap file. An already-running extension watches for
that handoff, so reconnecting does not require copying a token or a port.

The Host database still persists **only the token digest**. Browser and editor
credentials are separate: reconnecting VS Code cannot invalidate a browser
companion, and a browser credential cannot authenticate an editor payload.

The CLI install remains a development fallback only:

```bash
pnpm build:editor-extension
code --install-extension ./dsh-computer-history-editor.vsix --force
```

A manually installed development VSIX will wait until the Host's **Connect
automatically** action stages a credential. Legacy `dshComputerHistory.port` and
`dshComputerHistory.token` settings are read once, migrated into SecretStorage,
and are no longer exposed as normal extension settings.

## Allow or deny a workspace

The workspace root is a `resource`, so the panel's existing per-resource rules
apply — allow the roots you want, deny the rest. A denied workspace stores
nothing, and the denial is visible in the audit's redaction preview.

## The wire format, for another editor

Any editor that can POST to loopback can be a companion. One endpoint, one shape:

```http
POST http://127.0.0.1:<port>/companion/observation
x-companion-token: <the token from the panel>
content-type: application/json

{
  "source": "editor",
  "app": { "bundleId": "com.example.editor", "name": "Example Editor" },
  "workspaceRoot": "/Users/you/Projects/demo",
  "filePath": "/Users/you/Projects/demo/src/main.ts",
  "languageId": "typescript",
  "surfaceKind": "editor",
  "title": "main.ts",
  "event": "save",
  "editorSession": "any-stable-id",
  "seq": 1,
  "observedAtMs": 1790000000000
}
```

`201 {"stored":true}` means it was kept; `202 {"stored":false}` means the Host
refused it (the request was valid, the answer is about the store). The shipped VS Code companion reads that 202 body and records the refusal reason in its Computer History output/trace rather than treating every 2xx response as a successful store. A refusal that capture itself decided
- `capture-paused`, `collector-not-running`, `capture-disabled`, `capture-not-owned` - also carries
`reason`, so a client can tell "you paused" from "the policy refused this app" instead of logging nothing. `400` carries a
reason, `401` means the token is wrong, `403` means incognito (browser shape only).

**What `app` means.** It is a **claim**: the Host records the observation with
`source.provider = 'companion'`, so the audit can always tell "an editor said it
was Cursor" from "the operating system saw Cursor". The claim is validated (an
application-id-shaped `bundleId`, a non-empty `name`, no extra fields), and it
cannot unlock anything: an application the user has not allowed stores nothing,
and one the built-in protected list covers is dropped even if the user allowed it.

**What a client must never send.** There is no field for document text, a
selection, a diagnostic, a UI string or a file's contents, and unknown fields are
**refused rather than ignored** - so adding one is a protocol error, not a
harmless extra. Paths are metadata; contents are not.

**Activity events.** `event` is optional and the Host currently accepts only `save`. It means the editor reported a document-save event for the named file; it does **not** mean the Host read the file, diff, edit contents or diagnostics. The Host persists this as provenance and derives `changedResources` from save observations. A native Accessibility/UIA/AT-SPI observation cannot assert this event.

**Rules the client has to honour.** Send an absolute `workspaceRoot`; if you send
`filePath` it must live under that root. Use a stable `editorSession` per editor
run and a `seq` that increases; repeats of the same `(session, seq)` are dropped as
duplicates. Without a token, send nothing at all.

## Two traps worth knowing

- **A stale build looks exactly like a broken feature.** The Host only runs what
  is in `lib/`, so after changing the plugin: `pnpm build`, then reload the
  plugin entry. During this phase's live run an unbuilt Host answered an editor
  payload with the *browser* validator's error, which reads like a validation bug
  and is not one.
- **A hand-copied directory is not an installed extension.** VS Code keeps the
  installed set in `extensions.json` and does not rescan a directory you drop in
  by hand; the extension activates only after installing it through `code
  --install-extension` (or the GUI).
