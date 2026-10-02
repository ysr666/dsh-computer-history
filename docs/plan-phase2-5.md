# Phase 2.5 — Editor companion

Status: Ready to execute (owner asked for the editor companion first, 2026-10-02)
Boundary: ADR 0002 (metadata-only), 0004 (semantic layer), 0005 (store
protection), 0007 (companion trust boundary), 0008 (unlocatable file names).

## Why a companion and not more adapters

The question this phase answers: how do products avoid one adapter per
application? They do not adapt applications at all — they move the problem to
another layer:

1. **The operating system's accessibility layer** (macOS AX, Windows UIA, Linux
   AT-SPI) is a semantic tree the platform provides. Native toolkits and
   Electron both feed it, so one integration covers most applications. This is
   what `macos-ax` already uses. Its limit is that an application decides what
   it publishes: a browser's omnibox value and an editor's workspace identity are
   **not in the tree**, which is why our browser path needed a companion.
2. **Screenshots plus a vision model** buys application-agnosticism by giving up
   the semantic layer entirely — pixels in, synthetic input out. It is the only
   approach that is genuinely per-app free, and it is unavailable here: ADR 0002
   forbids screenshots.
3. **Platform-level aggregation** (workspace notifications, document controllers,
   Spotlight metadata) is the system's own cross-application view.

So the honest engineering answer is: cover applications through the OS layer, and
open a **trusted side channel** only where an application hides state from it.
That is exactly the companion pattern from ADR 0007, extended from the browser to
the editor.

## What this phase buys beyond coverage

Phase 2.3 left "unanchored" episodes: the Host could see that work happened but
not which workspace it belonged to, because Accessibility cannot vouch for a
workspace root. An editor extension can: `workspace.workspaceFolders` is the
editor's own answer. Episodes recorded with the companion in play become
**anchored**, Work Threads get real `threadKey`s, and the panel's unanchored copy
becomes the exception rather than the norm.

## Exit gate for 2.5

- `pnpm verify` and `pnpm verify:p1` green, with the editor companion's payload
  validation and its privacy tests inside `pnpm verify`.
- **No new trusted concept**: pairing, loopback intake, provider tagging and
  per-resource allow/deny all reuse ADR 0007 and the existing policy dimension.
- Contents are **not expressible**, not merely unsent: the payload type has no
  field for text, selections, or file contents, and a test asserts that an
  unknown field is refused.
- An episode recorded from the editor companion carries the workspace root the
  editor vouched for, proven by test and by a live run against real VS Code.
- `docs/editor-companion.md` (install, pair, allow, rotate) and
  `docs/validation-phase2-5.md`; ADR 0009 records the boundary.

---

## T2.5-0 — spike: what the editor can actually vouch for

Read the VS Code extension surface on the installed version: activation events,
`workspace.workspaceFolders`, `window.activeTextEditor`, `onDidChangeActiveTextEditor`
and `onDidChangeTextDocument` (for *when*, not *what*), and how an extension
reaches a loopback HTTP endpoint. Also check what is available **without** reading
document text, because that is the whole point.

**Acceptance:** the exact fields to send, each with the API it comes from, and an
explicit list of what is deliberately not read.

## T2.5-1 — ADR 0009: the editor companion boundary

One intake, two source kinds: the loopback listener and the pairing digest stay as
they are (ADR 0007); a payload declares `source: 'browser' | 'editor'`. A browser
payload may carry a URL; an editor payload may carry a workspace root, a file
path, a language id and a surface kind — and **nothing else**, enforced by the
type rather than by a filter. Per-workspace allow/deny reuses the existing
`resource` policy dimension, so no new consent concept appears.

## T2.5-2 — intake and observation mapping

**Write scope:** `src/host/companion/*`, `src/shared/protocol.ts`,
`src/shared/observation.ts`, tests.

**Deliverable:** the intake validates an editor payload the same way it validates
a browser one (loopback, Host header, pairing, size, rate), the observation
builder maps it to a `file` resource with the vouched workspace root, and the
`<content>` shape is unrepresentable.

**Acceptance:** an editor payload with a workspace root produces an anchored
observation; one carrying an unknown field is refused; one claiming a URL is
refused when it says `editor`; a paired-but-denied workspace stores nothing.

## T2.5-3 — the extension

**Write scope:** `extension-editor/` (new package), build script, tests.

**Deliverable:** a VS Code extension that pairs with a token, sends metadata on
active-editor and workspace changes, and never reads or sends document text or
selections. It fails closed when unpaired.

**Acceptance:** the extension's own unit tests cover the payload builder; a
packaging script produces a `.vsix`; the extension is installed and paired on the
real VS Code in this environment.

## T2.5-4 — anchoring, end to end

**Deliverable:** an episode recorded while the editor companion is active has the
workspace root the editor vouched for, and appears under that workspace in the
timeline rather than as unanchored.

**Acceptance:** a live run against real VS Code with the panel/timeline showing
the anchored episode, plus the API response behind it.

## T2.5-5 — documentation and the phase report

`docs/editor-companion.md`, `docs/validation-phase2-5.md`, roadmap entry, and
`docs/audit.md` gains the editor source in its export/audit description.

## Out of scope

Windows/Linux collectors, remote model processing (the owner's next phase), and
any read of document contents, selections, or editor UI text.
