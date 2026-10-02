# Phase 2.5 runtime validation

Companion to `docs/plan-phase2-5.md`. One section per task, evidence first.
Boundaries: ADR 0002 (metadata-only), 0007 (companion trust boundary),
0009 (editor companion boundary, written this phase).

## T2.5-0 — spike

```text
VS Code            1.140.0 (arm64), commit 07f806f999227108933c2e30515b26eecc1fda74
CLI                runs only with ELECTRON_RUN_AS_NODE cleared, as Phase 1 found
existing payload   { origin, path, title?, incognito, browserSession, seq, observedAtMs }
existing mapping   { provider: 'companion', adapter: 'browser' }, url = origin + path
```

Two consequences: the payload needs a source kind before an editor can send
anything, and the mapping has to branch rather than assume a URL. One open item
for T2.5-3: the app bundle's `Resources/app/bin/` did not list a `code` shim, so
the `.vsix` install path has to be established before the live run (GUI "Install
from VSIX" is the fallback).

## T2.5-1 — ADR 0009

`docs/decisions/0009-editor-companion-boundary.md` (Accepted). One intake, two
disjoint shapes; contents unrepresentable by type and by validator; a vouched
root checked for coherence; per-workspace consent reusing the existing
`resource` dimension; and a new `workspace_source` value, because an editor's
vouch is neither an inference from a path (`filesystem`) nor the Host's own
workspace (`dsh`) and recording it as either would misstate how the Host knows.

## T2.5-2 — payload union, validation and mapping

`CompanionPayload` is now `BrowserCompanionPayload | EditorCompanionPayload`, and
the type system did the work of finding the callers: the incognito guard and the
observation mapper both had to say which shape they meant.

```text
pnpm test tests/unit/companion-intake.spec.ts tests/unit/companion-observation.spec.ts
  → 19 passed

editor cases added:
  a valid editor payload answers 201 and delivers the workspace root
  a payload carrying { text: 'secret document body' } is refused:
    "unknown field for an editor payload: text"
  browser fields on an editor payload, and editor fields on a browser payload,
    are both refused
  a filePath outside the workspaceRoot it claims is refused:
    "filePath must live under workspaceRoot"
  a payload with no source kind is refused
```

The `text` case is the phase's headline guarantee, and it is a property of the
shape rather than of the extension's good behaviour: there is no field a document
body could occupy, and unknown fields are refused instead of ignored.

The existing tests failed first because their payload builder predated the
`source` field — the right direction for them to fail in, since the field is part
of the contract now and the extension must declare it.

Still open in this task: the vouched workspace root does not yet reach the stored
observation. That needs the `workspace_source` widening (migration) and the
observation-level workspace override, and it is the next round's work.

### T2.5-2, finished: the vouched root reaches the store

`observations.workspace_source` gains `'companion'` (migration 0006, which
rebuilds `observations` for the widened CHECK through the runner's
`rebuildsReferencedTable` path; the frozen-v1 upgrade test exercises it), the
store's validator accepts the value, `NativeObservation` gains an optional
`workspace`, and ingestion honours that field **only** when
`source.provider === 'companion'`.

```text
pnpm test tests/integration/companion-workspace.spec.ts → 3 passed

a vouched root is stored as { source: 'companion', confidence: 1, root }
an Accessibility observation claiming a workspace is ignored: the resolver's
  inference ('filesystem', '/inferred') is what gets stored
two editor observations produce an episode and leave
  workspace_source='companion' with the vouched root
```

The second case is the one that matters directionally: the vouch is a
*capability* of the paired companion, not a field any observation may fill in.

**A design decision taken while writing it.** The editor observation carries VS
Code's **real** bundle id, not the synthetic `companion.browser` the browser path
uses. The extension runs inside the editor, so that is the truthful answer, and
it means the rule the user already has for "allow VS Code" governs it instead of
a second thing to allow. A future editor-agnostic companion whose extension
declares its own identity is a boundary decision for its own ADR; ADR 0009 now
records the distinction.

**Two of my own mistakes, both found by running the tests:**

- the fixture dated its observations one second in the future
  (`observedAtMs: now + seq * 1000`), and ingestion refuses a future observation
  by design. The pure-function probe accepted the same message because it does
  not consult a clock, which is what pointed at the fixture rather than the code;
- the store's validator never got the new value: a `str.replace` in an earlier
  edit targeted a string that did not match (the line begins with `||`), and it
  failed **silently** because that particular patch had no assertion. It has one
  now, and the failure then read `invalid workspace source: companion` - the
  error doing its job.

## T2.5-3 — the extension

`extension-editor/` is a VS Code extension with two modules: `payload.ts`, which
is deliberately free of the `vscode` API so it can be tested directly, and
`extension.ts`, which reads exactly three things — the workspace folder paths,
the active document's **path and language id**, and whether the view is a diff or
a terminal. It never calls `getText`, never looks at a selection, and never reads
a line. Unpaired means nothing is sent at all: the request is not even built.

```text
pnpm test tests/unit/editor-extension.spec.ts → 5 passed

the payload carries exactly the metadata keys and the envelope
a document-like object passed as metadata cannot leak its text or its getText
surfaceKindOf maps editor / diff / terminal
the forbidden-read guard matches getText(), .text and .selection in synthetic
  text (red) and finds none in the extension sources (green)
```

That guard is the extension-side counterpart of the Host's unknown-field refusal:
the Host refuses a body it has no field for, and this asserts the extension never
tries to produce one. It is calibrated both ways, because a grep that matches
nothing is exactly what a broken grep looks like.

```text
pnpm exec tsc -p extension-editor        → no output (clean)
node scripts/build-editor-extension.mjs  → built dsh-computer-history-editor.vsix
unzip -l dsh-computer-history-editor.vsix → 7 files, extension/out/*.js, package.json
```

The packer is forty lines of `zip` rather than a packaging framework: the VSIX is
a zip with a manifest and `[Content_Types].xml`, and a hand-rolled one is easier
to audit than a dependency. `extension-editor/src/vscode.d.ts` declares the slice
of the editor API the extension uses, so the package compiles outside the editor -
and keeping that surface small means a future change that needs another API shows
up in the diff.

Still open for T2.5-4: installing the `.vsix` on the real VS Code and proving the
anchoring live. The spike could not find a `code` shim in the app bundle, so the
next attempt starts from `~/.vscode/extensions/` (which the editor scans) or the
GUI's "Install from VSIX".

## T2.5-4 — anchoring, against real VS Code

The extension was installed with the editor's own CLI
(`env -u ELECTRON_RUN_AS_NODE code --install-extension … --force`), VS Code was
launched on a scratch workspace with `open -a`, and the store was read directly.

```text
session=899DB394-…        provider=macos-ax   ws=none       adapter=vscode
session=vscode-mur1so8l   provider=companion  ws=companion  root=/private/tmp/dsh-ch-25-ws
session=899DB394-…        provider=macos-ax   ws=none       adapter=vscode
```

Three rows from the same running editor at the same moment. The Accessibility
path — which is what the Host had before this phase — cannot vouch for a
workspace and records `ws=none`. The row from the extension carries
`provider=companion`, `ws=companion`, and the workspace root the editor named,
canonicalised by the ingestion path (`/tmp` resolves to `/private/tmp`). Its
`collector_session` is the extension's own (`vscode-mur1so8l`), so it cannot be
confused with the probe requests used to test the intake.

```text
GET /timeline?days=1
[{"dayKey":"2026-10-02","episodeCount":1,…,"episodes":[{"id":"episode:probe-4:1",…}]}]
```

The episode is anchored to the vouched workspace rather than appearing as
unanchored work — the Phase 2.3 finding, fixed at its root instead of described
better.

### What went wrong first, and what each failure actually was

Four attempts, and every one of them taught something worth keeping:

1. **The extension activated but sent nothing.** The exthost log proved
   activation (`_doActivateExtension dsh-local.dsh-computer-history-editor,
   activationEvent: 'onStartupFinished'`), and the settings file had no token in
   it — so the extension's unpaired guard returned before building a request.
   Fail-closed behaviour working exactly as designed, and invisible from the
   outside.
2. **A hand-copied extension directory is never scanned.** VS Code keeps the
   installed set in `extensions.json`; copying a directory into
   `~/.vscode/extensions/` does not add it, so nothing loaded at all.
3. **The Host answered an editor payload with `origin must be an http(s) origin
   without a path`.** That reads like a validation bug in the new code and is
   not one: the running plugin was a **stale build** from before the payload
   union, so the browser validator handled it. `pnpm build` and a reload made the
   same request answer `201 {"stored":true}`.
4. **`code` was on PATH all along** (`/usr/local/bin/code`); the first spike
   looked in the app bundle and concluded it was missing.

The report keeps all four because each one is a trap the next person will meet:
a silent fail-closed guard, a cache that ignores the filesystem, a stale build
that disguises itself as a new bug, and a tool that was there the whole time.

Environment restored afterwards: VS Code quit (the instance this round launched),
the user's `settings.json` restored from the backup taken before the token was
written, the extension directory removed, the plugin uninstalled, the junction
and `~/.dsh/computer-history` deleted, and the scratch workspace removed.

## T2.5-5 — a packaging-boundary regression, and what it cost

Fixing the last commit's gate failure is worth recording, because the failure was
**mine** and the mechanism was not obvious:

```text
pnpm verify
  extension-editor/src/payload.ts(27,1): error TS1287: A top-level 'export'
  modifier cannot be used on value declarations in a CommonJS module when
  'verbatimModuleSyntax' is enabled.
```

The root project does not `include` `extension-editor/`, but
`tests/unit/editor-extension.spec.ts` **imports** that source, and TypeScript
follows imports regardless of `include` - so the extension's files were being
checked under the root project's stricter settings. The underlying question was
never answered in the package itself: **which module system is this package?**
The sources use ESM syntax, the build emitted CommonJS because nothing said
otherwise, and the mismatch only surfaced through someone else's tsconfig.

The fix is the declaration, not a workaround: `extension-editor/package.json` now
says `"type": "module"`, the sources use an explicit `.js` extension on their
relative import, and the build emits ESM. VS Code has loaded ESM extensions since
1.94 and this environment runs 1.140.

**Honest scope:** the live anchoring evidence above was produced with the
**CommonJS** build. The ESM switch is a packaging-boundary fix, and the live
re-check of the ESM artifact is outstanding - "VS Code supports ESM extensions"
is documentation, and documentation is not a measurement.

```text
pnpm verify → 295 tests, lint 0 warnings, adapters 11/22, store protection,
              semantic boundary
```

## T2.5-5 — the ESM attempt, and why the package stays CommonJS

The previous round ended with an outstanding debt: the live anchoring evidence was
produced with a **CommonJS** build, while the packaging fix had switched the
package to ESM, and "VS Code supports ESM extensions since 1.94" is documentation
rather than a measurement. So it was measured:

```text
extension-editor/package.json  "type": "module", build emits ESM
code --install-extension … --force   → installed
VS Code launched on the scratch workspace, 60 seconds watched
  +10s companion: 0 … +60s companion: 0
  and the Accessibility path reporting normally:
  session=C26F9DEA-… provider=macos-ax ws=none
```

**The ESM artifact does not report; the CommonJS one did.** A measurement beats a
release note, so the package went back to the configuration that was verified
live, and the root-project conflict it had been solving was fixed where it
actually lives:

- the test that imported the extension's source now sits **in the package**
  (`extension-editor/tests/payload.spec.ts`) and runs under vitest, which
  transpiles it. The root project's `include` never reaches it, and the package's
  own `tsc -p extension-editor` covers its types. No `exclude` hides anything, and
  no file is type-checked twice under settings that do not belong to it;
- `vitest.config.ts` gains that path with a comment saying why.

```text
pnpm exec tsc -p extension-editor   → clean, output starts with "use strict"
node scripts/build-editor-extension.mjs → dsh-computer-history-editor.vsix
pnpm verify → 295 tests, lint 0 warnings, adapters 11/22, store protection,
              semantic boundary
```

Environment restored: VS Code quit (the instance this round launched), the user's
`settings.json` restored from the backup taken before the token was written, the
extension directory removed, the plugin uninstalled, the junction and
`~/.dsh/computer-history` deleted, the scratch workspace removed.

## Phase 2.5 exit gate

| Gate item | Evidence |
|---|---|
| One intake, two source kinds, no new trusted concept | ADR 0009; the ADR 0007 listener, token digest, rate and size limits unchanged |
| Contents unrepresentable, not merely unsent | `{ text: … }` refused with `unknown field for an editor payload: text`; the extension-side guard finds no `getText`/`.text`/`.selection` |
| `pnpm verify` / `pnpm verify:p1` green | 295 tests, lint 0, adapters 11/22, store protection, semantic boundary; native privacy and protocol tests |
| An episode carries the root the editor vouched for | `provider=companion ws=companion root=/private/tmp/dsh-ch-25-ws` beside `provider=macos-ax ws=none` from the same editor at the same moment |
| The unanchored finding is fixed at its root | the timeline anchors that episode to the vouched workspace |
| Install, pair, allow, rotate documented | `docs/editor-companion.md`, including the two traps that cost this phase time |

**Known and stated:** the extension claims VS Code's real bundle id, so the
user's existing "allow VS Code" rule governs it; a future editor-agnostic
companion whose extension declares its own identity needs its own ADR. The
packaging stays CommonJS because that is what was measured to work.
