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
| `workspaceRoot` | `workspace.workspaceFolders[0].uri.fsPath` |
| `filePath` | `window.activeTextEditor.document.uri.fsPath` |
| `languageId` | `document.languageId` |
| `surfaceKind` | active view: editor, diff, terminal |
| `title` | the file's base name |

Not sent, and **not expressible**: document text, selections, diagnostics, UI
strings. The payload shape has no field for them, the Host refuses unknown
fields instead of ignoring them, and a guard test asserts the extension never
mentions `getText`, `.text` or `.selection` at all.

## Install and pair

```bash
pnpm build:editor-extension                      # → dsh-computer-history-editor.vsix
env -u ELECTRON_RUN_AS_NODE code --install-extension ./dsh-computer-history-editor.vsix --force
```

Then, in the Host panel, press **Create pairing token** and copy the value — it is
shown once, because the Host keeps only a digest. Put it in your editor settings:

```json
{
  "dshComputerHistory.port": 19388,
  "dshComputerHistory.token": "<the token>"
}
```

**Without a token nothing is sent**: the extension does not even build the
request. Rotating the token in the panel invalidates the previous one, and the
extension stops reporting until it is given the new one.

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
  "editorSession": "any-stable-id",
  "seq": 1,
  "observedAtMs": 1790000000000
}
```

`201 {"stored":true}` means it was kept; `202 {"stored":false}` means the policy
refused it (the request was valid, the answer is about the store). `400` carries a
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
