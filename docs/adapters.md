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
| `word` | `com.microsoft.Word` | document | `file://…` for the open document | unsupported (`-25205`) | readable (`AXSplitGroup`, no subrole) | file |
| `wps` | `com.kingsoft.wpsoffice.mac` | window | nil (`-25212`) | unsupported (`-25205`) | readable (`AXSplitGroup`) | none |
| `jetbrains` | `com.google.android.studio`, `com.jetbrains.*` (10 ids) | editor | nil (`-25212`) | unsupported (`-25205`) | readable in the welcome window (`AXButton`, 23 attributes); an unqueryable element (`-25202`) is tolerated per ADR 0006 | none |
| `obsidian` | `md.obsidian` | editor | empty on the vault picker | unsupported (`-25205`) | unavailable (`-25212`) | none |
| `notes` | `com.apple.Notes` | window | nil (`-25212`) | unsupported (`-25205`) | readable (`AXTextArea`) | none |
| `browser` | `companion.browser` | browser | n/a (the companion sends the address) | n/a | n/a | url |
| `terminal` | `com.apple.Terminal`, `com.googlecode.iterm2` | terminal | working directory (`file://…` / path) | unsupported (`-25205`) | readable on iTerm2; `-25212` inside Terminal | directory |
| `preview` | `com.apple.Preview` | document | `file://…` for the open document | unsupported | readable | file |
| `finder` | `com.apple.finder` | window | nil for plain windows; folder path in folder windows | unsupported (`-25205` / `-25212`) | readable (`AXGroup`) | none or file |

Windows ids for the same adapters: `finder` = `explorer.exe` and `terminal` =
`WindowsTerminal.exe`, both **measured 2026-10-04** on Windows 11 26200 with
`cargo run --release --example foreground_identity` plus live collector runs; `vscode` =
`Code.exe`, which is **expected rather than measured** because VS Code is not installed on that
machine. The measurement corrected the earlier expected values (`Microsoft.WindowsTerminal`,
`Microsoft.VisualStudioCode`): the packaged applications measured there (Notepad, Windows Terminal)
reported **no window AppUserModelID at all**, so the executable name is what Windows handed the
collector - the Start menu's `Microsoft.WindowsTerminal_8wekyb3d8bbwe!App` is not a window property.
That is the scope of the measurement: two packaged applications and one classic one, not a rule about
every Windows application.

Linux ids for the same adapters are declared in the fixture as well - `vscode` = `code.desktop`,
`code-insiders.desktop`; `terminal` = `org.gnome.Terminal.desktop`; `finder` =
`org.gnome.Nautilus.desktop` - and they are in the Host table for the same reason the win32 ids are:
without them the first Linux observation would be refused as `not-an-adapter`. **None of them has been
measured**, because no Linux machine has run the collector; `docs/validation-three-platforms.md` records
that state.

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

### `word` — Microsoft Word

```json
{"adapter":"word","app":"com.microsoft.Word","privacy":{"secure":false},
 "window":{"document":"file:///tmp/dsh-verify-fixtures/sample.rtf","title":"sample  -  兼容性模式"}}
```

Measured 2026-10-02 with a synthetic RTF
(`open -a "Microsoft Word" /tmp/dsh-verify-fixtures/sample.rtf`), then
`bin/verify/activate --pid <word pid> --budget 90` and
`node scripts/verify/live-probe.mjs --allow com.microsoft.Word --seconds 20`.
Word exposes the file URL and its focused element is readable, so it behaves
like Preview rather than like WPS below.

### `wps` — WPS Office

```json
{"adapter":"wps","app":"com.kingsoft.wpsoffice.mac","privacy":{"secure":false},
 "window":{"title":"[只读]sample.rtf"}}
```

Measured 2026-10-02 on the same synthetic RTF. WPS reports **no**
`kAXDocument` (`-25212`) and no `kAXURL` (`-25205`), so its observations carry a
title and no resource; the surface stays `window`. Two observations were
produced and both matched this shape. This is the same class as Finder's plain
windows and Cursor's Agents window, and it is the case the aggregation rule in
T2.0-7 exists for.

### `jetbrains` — the IntelliJ platform (Android Studio)

```json
{"adapter":"jetbrains","app":"com.google.android.studio","privacy":{"secure":false},
 "window":{"title":"Welcome to Android Studio"}}
```

Measured 2026-10-02 with the injected plugin (allow rule for
`com.google.android.studio`) and with `bin/verify/ax-probe --attributes`:
Android Studio stored four observations (title present, `element_role`
`AXButton`, no resource). The IntelliJ family reports **no document**, so these
observations carry titles only; the aggregation rule treats them as window-level
activity, and the panel shows them without a resource.

The adapter declares `focusedElementPolicy: window-only` (ADR 0006): during its
startup phase the application twice handed out a focused-element reference that
rejected every read (`-25202` on role, subrole, the attribute list and the
parent). That state did not reproduce afterwards (twelve samples across a cold
start read a normal `AXButton`), so the tolerance is proven by the fixture pair
in `docs/validation-phase2-0.md`, not by a stored row. A readable secure field
still withholds the observation, which the same section shows at both the
collector and the host level.

A real JetBrains IDE was measured as well: IntelliJ IDEA CE 2025.3
(`com.jetbrains.intellij`, opened through its LightEdit entry point with a
synthetic file) produced

```json
{"adapter":"jetbrains","app":"com.jetbrains.intellij","privacy":{"secure":false},
 "document":null,"titlePresent":false,"elementRole":"AXButton"}
```

with a readable focused element (23 attributes, subrole absent). Its window
title was empty on the startup screen, so the observation carries neither a
resource nor a title — the window-only ground truth for the family.

The eight other bundle ids share the platform but were not installed on the
validation machine; their rows are unmeasured:

- `com.jetbrains.intellij`, `com.jetbrains.intellij.ce`
- `com.jetbrains.pycharm`, `com.jetbrains.pycharm.ce`
- `com.jetbrains.goland`, `com.jetbrains.webstorm`, `com.jetbrains.clion`
- `com.jetbrains.rustrover`, `com.jetbrains.datagrip`

### `obsidian` — Obsidian 1.13.7

```json
{"adapter":"obsidian","app":"md.obsidian","privacy":{"secure":false},
 "document":null,"title":"Obsidian","elementRole":null}
```

Measured 2026-10-02 (cask 1.13.7, opened with a synthetic vault in `/tmp`):
the application is a Chromium case — `kAXFocusedUIElement` answers `-25212`
(noValue, the same positive evidence VS Code and Cursor give), the window title
reads normally, `kAXURL` is unsupported and the window document was **empty** on
the vault picker, so no resource. A measurement with a note actually open (to
see whether the document then carries the file) is still pending; the adapter is
`editor` because that is the application class, and the resource stays absent
until a document appears.

### `notes` — Apple Notes

```json
{"adapter":"notes","app":"com.apple.Notes","privacy":{"secure":false},
 "titlePresent":true,"elementRole":"AXTextArea"}
```

Measured 2026-10-02 on the owner's running instance, with the title value
deliberately **not** recorded: Notes exposes a readable focused element
(`AXTextArea`), no window document (`-25212`) and no `kAXURL` (`-25205`), so a
note is a title-only surface and the observation carries no resource. The
adapter document says nothing about note content, and none was read or stored
during the measurement.

### `browser` — the companion's synthetic source

```json
{"adapter":"browser","app":"companion.browser","provider":"companion",
 "window":{"title":"Example page","url":"https://example.test/docs/guide"}}
```

Not an application: this adapter is the provenance the paired browser companion
reports (ADR 0007), and no real application carries the bundle id, so the
Accessibility path can never produce it. Verified 2026-10-02 against the running
Host — a paired `POST http://127.0.0.1:19388/companion/observation` with
`path=/docs/guide?token=secret#frag` stored one observation whose resource is
`url https://example.test/docs/guide` (query and fragment gone), while an
unpaired POST answered 401, an incognito payload answered 403 and a POST during
pause answered `202 {stored:false}`. The full recipe is in
`docs/validation-phase2-1.md`, T2.1-2b.

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

## Adding an adapter does not add policy

`protectedBundleIds` is derived by matching the policy's rules against the
supported bundle ids (`bundleIdsFor('protect')` in the collector manager), so a
new adapter inherits protection only when an existing rule matches it — a
`com.apple.*` rule covers a new Apple adapter, while a third-party adapter stays
unmatched. That is safe rather than leaky: capture is include-only, so an app
with no allow rule is not captured at all. It does mean a new adapter is
silent until someone allows it, which is the intended product default.

## Known gaps

- **Browsers have no adapter.** `kAXDocument` carries the page URL in Chrome
  (measured as `https://…` during Phase 1), but browser capture stays
  fail-closed until the companion in 2.1 can guarantee private-mode exclusion.
- **Cursor Agents window**: empty document, see above.
- **Notes is deliberately unmeasured**: opening it displays the user's real
  notes, and the window title would be a note title. Measuring it needs the
  owner's go-ahead or a synthetic note source, so the adapter stays out rather
  than being added on an assumption.
- **JetBrains family is blocked on a decision, not on a download.**
  Android Studio (the IntelliJ platform, `com.google.android.studio`) hands out
  a focused-element reference that is not queryable at all: role, subrole and
  even the attribute list return `-25202` (`kAXErrorIllegalArgument`) while the
  window reads normally (`AXStandardWindow`, title present, document
  `-25212`). The current fail-closed rule therefore drops these observations.
  ADR 0006 (proposed) recommends a per-adapter `window-only` declaration; until
  the owner decides, the fail-closed behaviour stays and no JetBrains adapter
  is added. Measured 2026-10-02 with
  `bin/verify/ax-probe <pid> 1 --attributes`.
- **Pending adapters**: none. Every adapter in the shared table has a measured
  row; the only unmeasured entries are the eight `com.jetbrains.*` bundle ids
  listed above, which share a measured platform.
