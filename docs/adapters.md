# Adapter evidence table

One row per Phase 1 adapter, with the real-machine measurement that produced
it. `T2.0-8` turns the completeness of this table into a check
(`pnpm verify:adapters`); until then it is maintained by hand, and a row without
a date and a command is not evidence.

Probe recipes live in `docs/verification-guide.md`. Every measurement here used
synthetic fixtures — never a real private file or a real credential.

| adapter | bundle ids | surface | document (`kAXDocument`) | `kAXURL` | focused element | resource |
|---|---|---|---|---|---|---|
| `vscode` | `com.microsoft.VSCode`, `com.todesktop.230313mzl4w4u92` | editor | `file://…` on the editor window | unsupported (`-25205`) | unavailable (`-25212`) | file |
| `xcode` | `com.apple.dt.Xcode` | editor | `file://…` on the editor window | unsupported (`-25205`) | readable (`AXGroup` / `AXHostingView`) | file |
| `terminal` | `com.apple.Terminal`, `com.googlecode.iterm2` | terminal | working directory (`file://…` / path) | unsupported (`-25205`) | readable on iTerm2; `-25212` inside Terminal | directory |
| `preview` | `com.apple.Preview` | document | `file://…` for the open document | unsupported | readable | file |
| `finder` | `com.apple.finder` | window | nil for plain windows; folder path in folder windows | unsupported (`-25205` / `-25212`) | readable (`AXGroup`) | none or file |

## Rows

### `vscode` — VS Code 1.140.0 and Cursor 3.23.12

```json
{"adapter":"vscode","app":"com.todesktop.230313mzl4w4u92","privacy":{"secure":false},
 "window":{"document":"file:///tmp/dsh-live-fixtures/normal-text.html","title":"normal-text.html"}}
```

Measured 2026-10-02 with `scripts/verify/live-probe.mjs --allow <bundle>` plus
`ax-probe`. Both applications are Chromium-based: the application element
returns `-25212` for `kAXFocusedUIElement` and there is no system-wide
alternative (`-25204`), while window attributes read normally. Treating a
missing attribute as "not secure" instead of a failed read is what fixed F11.

Cursor 3.x note: the default **"Cursor Agents"** window reports an empty
`kAXDocument`, so only the title is available there. The classic editor window
(open a file directly) exposes the `file://` URL like VS Code. A user who works
only in the Agents window therefore produces title-only observations, which the
aggregation rule in T2.0-7 handles.

### `xcode` — Xcode 27.0 (27A266a)

```json
{"adapter":"xcode","app":"com.apple.dt.Xcode","privacy":{"secure":false},
 "window":{"document":"file:///tmp/dsh-verify-fixtures/sample.swift","title":"sample.swift"}}
```

Measured 2026-10-02: `open -a Xcode /tmp/dsh-verify-fixtures/sample.swift`, then
`bin/verify/activate --pid <xcode pid> --marker sample.swift` followed by
`node scripts/verify/live-probe.mjs --allow com.apple.dt.Xcode --seconds 26`.
Two observations, both with the document and title. Xcode's focused element is
readable (`AXGroup`, subrole `AXHostingView`), so it is not a Chromium case.

The "What's New in Xcode" sheet reports an empty document; the editor window is
the one that carries the file. Before the adapter entry existed the collectible
surface was asserted in native tests (`phase1AdapterForBundle` returns nil), not
by a probe: a probe without Xcode in the foreground cannot distinguish "no
adapter" from "not frontmost", and the first baseline attempt was inconclusive
for exactly that reason.

### `terminal` — Terminal.app and iTerm2 3.7.3

Titles are never recorded for this adapter (`suppressesWindowTitle`), and the
document is a working directory, so the resource kind is `directory`. iTerm2
3.7.3 measured 2026-10-02 (`bin/verify/activate` + probe) with
`{"adapter":"terminal","privacy":{"secure":false}}` and element
`{role: AXButton, identifier: action-button-2}`; its first-run window is an
`AXDialog` whose `kAXDocument` returns `-25212`. Terminal.app's secure-field
behaviour was fixed in F4: a missing subrole is positive evidence of a plain
field, only a failed read fails closed.

### `preview` — Preview

```json
{"document":"file:///private/tmp/dsh-live-fixtures/preview-fixture.pdf","title":"preview-fixture.pdf – 1页"}
```

Measured 2026-10-02 during the Phase 1 runtime validation (reproduced twice): a
document application exposes the file URL, so resource attribution works.

### `finder` — Finder

```json
{"title":"dsh-live-fixtures"}
```

No `document` and no `url`: `kAXDocument` is nil for plain Finder windows (a
download window, a desktop window), so those observations carry no resource.
The Host stored seven Finder observations during the Phase 1 validation and all
seven had an empty `resource_id`, which is why the roadmap treats Finder as a
window surface rather than a document surface.

## Known gaps

- **Browsers have no adapter.** `kAXDocument` carries the page URL in Chrome
  (measured as `https://…` during Phase 1), but browser capture stays
  fail-closed until the companion in 2.1 can guarantee private-mode exclusion.
- **Cursor Agents window**: empty document, see above.
- **Pending adapters** (T2.0-2, T2.0-4): JetBrains family, Obsidian, Word, WPS,
  Notes. Each needs the same row: bundle id, measured AX facts, resource
  outcome, command, date.
