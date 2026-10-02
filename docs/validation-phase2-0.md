# Phase 2.0 runtime validation

Companion to `docs/plan-phase2-0.md`. One section per task, evidence first:
the command that produced the result, then the result. Environment is restored
after every section (applications quit, fixtures cleaned, junctions removed).

Boundary in force: ADR 0002 (metadata-only) and ADR 0004 (semantic enrichment).
All fixtures are synthetic; no real private file, note, or credential was
opened for any measurement below.

## T2.0-0 — verification toolkit in the repo

`pnpm verify:tools` builds `bin/verify/{ax-probe,activate}`; the probe and the
fixture builder run from `scripts/verify/`. `pnpm verify` is green (204 tests
at the time).

Two findings from running the tools rather than reading them:

- The privacy guard scanned `scripts/` and immediately matched **its own
  denylist**, failing every run. It now excludes itself by name, and the
  exclusion is commented as the single exemption.
- A probe without an application in the foreground cannot distinguish "no
  adapter" from "not frontmost". The FIRST Xcode baseline was taken that way
  and was therefore inconclusive; it was replaced by a test assertion on the
  registry (see T2.0-3).

## T2.0-1 / T2.0-1b — adapter registry and single source of truth

`pnpm native:test` and `pnpm verify` green (208 tests). The repository's own
Host/native allowlist guard parsed the old `bundle == "..."` shape, so the
registry rewrite failed it until the guard learned to read `bundleIds` arrays —
a drift guard catching a shape change is the guard working.

Calibration of the new guard was done from both sides: forcing one
`surfaceKind` in the Swift registry to differ from the TS table fails
`tests/repository.spec.ts > keeps the Host and native adapter tables identical`;
restoring it returns 208/208. `normalize.ts` now takes surface kind, title
policy and file-vs-directory from `PHASE1_ADAPTERS`, and an unknown bundle id
resolves to nothing instead of a generic surface.

## T2.0-3 — Xcode adapter (real machine)

```json
{"adapter":"xcode","app":"com.apple.dt.Xcode","privacy":{"secure":false},
 "window":{"document":"file:///tmp/dsh-verify-fixtures/sample.swift","title":"sample.swift"}}
```

Xcode 27.0 (27A266a), synthetic `sample.swift`, command sequence in
`docs/adapters.md`. Two observations, both with document and title; the focused
element is readable (`AXGroup`/`AXHostingView`). `pnpm native:test` green,
`pnpm verify` green (208), policy-compilation expectation updated for the new
supported bundle.

## T2.0-4 — Word and WPS (real machine, partial)

Word: `{"adapter":"word","window":{"document":"file:///tmp/dsh-verify-fixtures/sample.rtf","title":"sample  -  兼容性模式"}}`.

WPS: `{"adapter":"wps","window":{"title":"[只读]sample.rtf"}}` — no document
(`-25212`), no URL (`-25205`), so the surface stays `window` and the rows carry
a title only.

Both probes needed the idle-gated activation twice: the first Word attempt
reported "gave up after 0 attempt(s)" because the session was busy, and a probe
started in that state would have produced zero observations and looked like a
product failure.

**Notes is deliberately unmeasured**: opening it displays the owner's real
notes and the window title would be a note title. It needs an explicit
decision, not a measurement taken without consent.

## T2.0-2 — JetBrains family (blocked on a decision)

Android Studio (`com.google.android.studio`, IntelliJ platform) measured with
`bin/verify/ax-probe <pid> 1 --attributes`:

```text
focusedUIElement(err=0)
  role(err=-25202) subrole(err=-25202)
  attributeNames(err=-25202 count=0)   # even the attribute list fails
parent: not readable
focusedWindow role=AXWindow subrole=AXStandardWindow title=ok
window document(err=-25212) axurl(err=-25205)
```

`-25202` (`kAXErrorIllegalArgument`) is a third shape, distinct from the
Chromium missing-attribute case (`-25212`). The current fail-closed rule treats
it as unreadable and drops the observation, so the whole IntelliJ family is
uncapturable today. ADR 0006 (Proposed) recommends a per-adapter `window-only`
declaration that keeps the classifier unchanged; the conservative behaviour
stays until the owner decides. No JetBrains adapter was added.

## T2.0-5 — workspace attribution: diagnosis corrected, semantics pinned

The task was written as "stop losing the workspace root". The real data from
the VS Code end-to-end run (`/tmp/dsh-ch-vscode-e2e/history.sqlite`) says the
behaviour is by design:

```text
seq 1  Visual Studio Code   resource=-   workspace=none   → orphan, no episode
seq 2  normal-text.html     resource=-   workspace=none   → orphan, no episode
seq 3  normal-text.html     resource=1   workspace=filesystem → anchors the episode
```

At seq 1–2 the collector had not read a document yet, so the observation is
stored as evidence and anchors nothing; the episode starts when a resource is
actually observed, and it must not claim a workspace that was never observed.
Nothing is lost incorrectly, and the acceptance as originally written was
already satisfied by existing behaviour.

Two tests now pin that decision (`tests/unit/episode-builder.spec.ts`,
"document-less observations"): a document-less observation stays out of the
episode its successor anchors, and a document-less observation inside an
episode is recorded as a detour rather than silently promoted into it.
`pnpm test` green (210 tests).

The open question — should an early document-less observation later be adopted
by the episode its window turns out to belong to — is a fidelity-versus-
inference tradeoff and is handed to T2.0-7 with this data attached, instead of
being implemented speculatively.

## T2.0-8 — adapter evidence gate

`pnpm verify:adapters` → `adapter evidence complete: 7 adapters, 9 bundle ids
(vscode, xcode, word, wps, terminal, preview, finder)`.

The parser was written against the wrong indentation first and reported "no
adapters parsed" — a guard that fails on its own input is not a guard, so it
now matches on content and says why it found nothing. Calibration from both
sides: deleting the `wps` row makes it fail (`docs/adapters.md: adapter "wps"
has no evidence row`, pnpm reports exit code 1); restoring it passes. The check
is part of `pnpm verify`, so evidence rot now breaks the normal gate.

## Pending in 2.0

`T2.0-2` (owner decision on ADR 0006), `T2.0-6` (Cursor Agents metadata
review), `T2.0-7` (aggregation rule + metric + the adoption question above),
`T2.0-9` (at-rest protection, ADR 0005), `T2.0-10` (threat model),
`T2.0-11` (store self-check).
