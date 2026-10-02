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
