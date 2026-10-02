# Phase 2.0 — Task list (quality and trust base)

Status: Ready to execute (user approved 2026-10-02)
Boundary: ADR 0002 (metadata-only, no clicks/keystrokes/content) and
ADR 0004 (semantic enrichment boundary) both apply.

Phase 2.0 is W2 (adapter coverage and resource quality) plus W5 (at-rest
protection and threat model) from `docs/plan-phase2.md`.

## How to read a task

Every task lists: goal, **write scope** (files it may touch), deliverables,
acceptance (commands and evidence), dependencies, and the real-machine recipe.
No task may add a content-bearing AX attribute; that needs the ADR 0002 review
path recorded in the task.

## Exit gate for 2.0

- `pnpm verify:p1` green, and a new `pnpm verify:adapters` green (contract
  tests plus evidence-table completeness).
- `docs/adapters.md` has one real-machine evidence row per adapter.
- ADR 0005 (at-rest protection) is Accepted and implemented, with
  `node scripts/verify-store-protection.mjs` failing on an unprotected store.
- `docs/threat-model.md` exists and `SECURITY.md` links it.
- Every task ends with: environment restored, forward commit only, one section
  appended to the validation report.

---

## T2.0-0 — Verification toolkit into the repo (do first)

**Goal:** make the Phase 1 validation recipe reusable and reviewable instead of
living in `/tmp`.

**Write scope:** `scripts/verify/`, `scripts/verify-privacy-boundary.mjs`,
`docs/verification-guide.md`, `package.json`.

**Deliverables**

- `scripts/verify/live-probe.mjs` — the native NDJSON probe (`--allow`,
  `--protect`, `--seconds`, `--log`).
- `scripts/verify/ax-probe.swift` — AX attribute dump (focused element,
  window, document, URL) built by `native:build`'s toolchain settings.
- `scripts/verify/activate.swift` — idle-gated `kAXRaise` activation
  (`--pid`, `--marker`, `--budget`), because frontmost-app tests must not fight
  the user for focus.
- `scripts/verify/fixtures/` — synthetic AppKit fixture source and builder
  (secure/plain/hung modes, bundle id overridable).
- `docs/verification-guide.md` — the four method rules: two-sided probe
  calibration, partition by `collector_session`, same-input differentials,
  idle-gated activation; plus "never real private files or credentials".

**Acceptance:** `node scripts/verify/live-probe.mjs --help` runs; `pnpm
verify:privacy` scans `scripts/` too (extend `roots`); the guide is linked from
`docs/development.md`.

**Depends on:** nothing.

---

## T2.0-1 — Adapter registry and data-driven behaviour

**Goal:** adding an adapter is a data change, not a new `if` branch.

**Write scope:** `native/macos/Sources/ComputerHistoryCollector/SupportedApps.swift`,
`.../Collector.swift`, `native/macos/Tests/ComputerHistoryCollectorTests/SupportedAppsTests.swift`,
`scripts/test-native.mjs`, `tests/repository.spec.ts` (amended during execution:
the existing Host/native allowlist drift guard parsed the old `bundle ==` shape
and had to learn the registry shape), `docs/adapters.md`.

**Deliverables**

- `Phase1Adapter` value type: `id`, `bundleIds`, `surfaceKind`,
  `suppressesWindowTitle` (replaces the `adapterName == "terminal"` literal in
  `Collector.swift`).
- A native precondition that every adapter has an explicit title policy and at
  least one bundle id.

**Acceptance:** `pnpm native:test` green; the title-suppression regression for
Terminal and iTerm2 is asserted from the registry, not from a string compare.

**Depends on:** T2.0-0.

---

## T2.0-2 — JetBrains family adapters

**Goal:** cover IntelliJ IDEA, PyCharm, GoLand, WebStorm, CLion, RustRover,
DataGrip, Android Studio.

**Write scope:** the native registry, `src/shared/constants.ts`,
`src/shared/observation.ts`, the tests that pin policy compilation
(`tests/unit/collector-hardening.spec.ts`) and `docs/adapters.md`.
Adding an adapter touches those four places, and the drift guard makes a
missed one fail rather than degrade silently.

**Deliverables:** bundle-id mappings (`com.jetbrains.*` including `.ce`
variants) plus the measured AX outcome per app.

**Acceptance:** contract test per bundle id; one real-machine observation row
per installed app in `docs/adapters.md`.

**Real-machine recipe:** install one IDE → open a synthetic file from
`scripts/verify/fixtures/` → `node scripts/verify/live-probe.mjs --allow
com.jetbrains.intellij --seconds 15`.

**Risk:** Swing/AWT apps may expose no `kAXDocument`. If so the outcome is
"title only" and the row must say so; the aggregation rule comes from T2.0-7.

**Depends on:** T2.0-0, T2.0-1.

---

## T2.0-3 — Xcode adapter

Same shape as T2.0-2 for `com.apple.dt.Xcode` (added in the same commit as T2.0-1b follow-up). Xcode is AppKit, so expect a
readable document; verify with a synthetic `.swift` fixture, never a real
project.

**Depends on:** T2.0-0, T2.0-1.

---

## T2.0-4 — Notes, Obsidian, Word, WPS

Same shape; one row each. Apple Notes is the interesting case: its document may
be a note identifier rather than a path, which is metadata and acceptable, but
must be recorded as such.

**Depends on:** T2.0-0, T2.0-1.

---

## T2.0-5 — VS Code workspace attribution stability

**Goal (corrected during execution):** understand what happens when a window's
first observations arrive before `kAXDocument` is readable, and pin the answer.

The original goal assumed a defect ("stop losing the workspace root"). The
evidence says otherwise: the document-less observations are stored as evidence
and anchor no episode, which is the documented design, and the acceptance as
first written was already met by existing behaviour. See
`docs/validation-phase2-0.md` T2.0-5 for the real rows.

**Write scope:** `tests/unit/episode-builder.spec.ts` (the pinning tests),
`docs/validation-phase2-0.md`.

**Deliverable:** tests that pin the two cases (a document-less observation does
not join the episode its successor anchors; a document-less observation inside
an episode is a detour), and the adoption question handed to T2.0-7 with the
real data.

**Acceptance:** `pnpm test` green with the two new cases; the real-machine rows
recorded in the validation report.

**Depends on:** T2.0-0.

---

## T2.0-6 — Cursor 3.x "Cursor Agents" window (metadata-only exploration)

**Goal:** the new Cursor window reports an empty `kAXDocument`, so the active
file is invisible. Decide whether a *metadata* attribute on a descendant
(the web area's document/URL) can supply it **without** reading content.

**Write scope:** `Privacy.swift` (positive allow-list),
`native/macos/Sources/ComputerHistoryCollector/Collector.swift`,
`native/macos/Tests/.../PrivacyTests.swift`, `docs/decisions/` (review note).

**Rules:** ADR 0002 requires an architecture/privacy review and tests before
adding an attribute; the review note must name the attribute, why it is
identity rather than content, and what it can leak.

**Acceptance:** either the attribute is added under review with a passing
privacy check and a real Cursor observation carrying the file, or the review
concludes "not available" and the outcome is recorded with the fallback.

**Depends on:** T2.0-0, T2.0-1.

---

## T2.0-7 — Unanchored aggregation and metric

**Goal:** observations with neither resource nor workspace ("Unanchored
activity", visible in the panel today) should aggregate per application and
surface instead of producing one episode each.

**Write scope:** `src/host/episodes/builder.ts`,
`tests/unit/episode-*.spec.ts`, `scripts/verify/unanchored-metric.mjs`.

**Also decide (handed over from T2.0-5):** whether an early document-less
observation should be adopted by the episode its window later turns out to
belong to (fidelity) or stay evidence-only (no inference). Real data and the
current pinned semantics are in `docs/validation-phase2-0.md` T2.0-5.

**Acceptance:** unit tests for the aggregation boundary (same app+surface
merges; a resource-bearing observation still starts/extends a resource
episode); a scripted 30-minute session reports the unanchored rate as a number
recorded in the report, to be compared after every later adapter lands; and the
adoption question is answered in writing with the tests that follow from the
answer.

**Depends on:** T2.0-0.

---

## T2.0-8 — Adapter documentation and evidence table

**Deliverables:** `docs/adapters.md` with one row per adapter: bundle ids,
surface kind, measured AX facts, resource outcome (file URL / URL / identifier
/ none), privacy notes, and the exact probe command plus date that produced it.

**Acceptance:** `pnpm verify:adapters` fails when an adapter has no evidence
row or when a row lacks a date/command.

**Depends on:** T2.0-2 … T2.0-6.

---

## T2.0-9 — At-rest protection: spike, ADR 0005, implementation

**Context:** the store is plain SQLite with `0600` inside a `0700` directory —
the same weakness the press criticised in OpenAI's Computer History.

**Candidates to evaluate (spike, then ADR):**

1. SQLCipher via a native binding — strongest, heaviest, needs a build step.
2. Field-level encryption of the revealing columns (`window_title`,
   `canonical_uri`, `workspace_root`, `element_identifier`) with a Keychain
   key — keeps the store and file sizes, but must not break search.
3. OS-level: rely on FileVault, keep SQLite plaintext, and enforce/document it
   — weakest, cheapest.

**Constraints:** search and FTS must keep working; WAL crash recovery must
survive; the key lives in the Keychain; export/re-import stays possible.

**Deliverables:** `docs/decisions/0005-store-protection.md` (Accepted with the
spike evidence), the implementation, and
`scripts/verify-store-protection.mjs` (new store must be encrypted, `0600`
files, `0700` directory).

**Acceptance:** the script fails on the pre-change store and passes after;
`pnpm verify:p1` green; the export path still round-trips.

**Depends on:** T2.0-0.

---

## T2.0-10 — Threat model

**Deliverables:** `docs/threat-model.md` — assets (observations, episodes,
resources, policy), adversaries (local infostealer, backup/Time Machine copy,
another local user, a malicious plugin in the profile), what each learns from
raw observations versus derived episodes, and the mitigations actually present
(TTL, deletion consistency, allow-list, fail-closed gates, key handling).

**Acceptance:** `SECURITY.md` links it; every mitigation named is backed by a
test or a script in the repo.

**Depends on:** T2.0-9 (key handling).

---

## T2.0-11 — Store self-check in the normal loop

**Deliverables:** `scripts/verify-store-protection.mjs` wired into
`pnpm verify:adapters` (or `verify`), plus unit tests for permissions and the
encryption check.

**Acceptance:** `pnpm verify` fails when a store is created world-readable or
unprotected, proven by temporarily reverting the protection in a fixture.

**Depends on:** T2.0-9.

---

## Order

| Step | Tasks | Gate |
|---|---|---|
| 2.0.a | T2.0-0, T2.0-1 | tooling in repo, registry data-driven, `native:test` green |
| 2.0.b | T2.0-2 … T2.0-4 | adapter contract tests + `docs/adapters.md` rows |
| 2.0.c | T2.0-5, T2.0-6, T2.0-7, T2.0-8 | attribution test, review note, unanchored number, `verify:adapters` |
| 2.0.d | T2.0-9 … T2.0-11 | ADR 0005 Accepted, protection enforced, threat model linked |

## Out of scope for 2.0

Browser companion (2.1), semantic summaries and work threads (2.2), UI/audit
(2.3), Windows/Linux collectors, and any click/keystroke/content capture.

## Progress

| Task | Status | Evidence |
|---|---|---|
| T2.0-0 toolkit into the repo | done | commit `215e9e1`; `pnpm verify:tools` builds both helpers; `pnpm verify` green (204 tests); guard scans `scripts/` after excluding itself (self-reference caught by running it) |
| T2.0-1 adapter registry | done | commit pending; `Phase1Adapter` registry replaces the `adapterName == "terminal"` test; XCTest invariants + preconditions; `pnpm native:test` green; the repo's own Host/native allowlist guard was updated to read `bundleIds` |
| T2.0-1b adapter table single source | done | `PHASE1_ADAPTERS` in `src/shared/constants.ts` is canonical; looked up by `normalize.ts` for surface kind, title policy and resource kind; the repository guard now compares all four fields against the Swift registry, and a deliberate `surfaceKind` drift was used to prove the guard fails (208/208 when restored) |
| T2.0-3 Xcode adapter | done | registry + shared table + union; real Xcode 27.0 probe recorded in `docs/adapters.md` (`adapter=xcode`, `document=file://…/sample.swift`); policy-compilation test updated for the new supported bundle; 208/208 |
| T2.0-4 Word + WPS adapters | partial | Word: `adapter=word` + `document=file://…/sample.rtf`; WPS: `adapter=wps`, no document (`-25212`), title-only rows; both recorded in `docs/adapters.md`. Notes deliberately unmeasured (shows the user's real notes); Obsidian pending download |
| T2.0-2 JetBrains family | blocked on ADR 0006 | measured: IntelliJ platform returns an unqueryable focused element (`-25202` on role/subrole/attribute list) while the window reads fine, so the fail-closed rule drops everything. ADR 0006 (proposed) offers a per-adapter `window-only` declaration; conservative default kept meanwhile. `ax-probe --attributes` added to make the distinction measurable |
| T2.0-5 document-less observations | done (diagnosis corrected) | real e2e rows show seq 1-2 are evidence-only orphans by design; the original acceptance was already met, so the task was amended to pin the semantics with two tests (210 green) and to hand the fidelity question to T2.0-7 |
| T2.0-8 `verify:adapters` | done | `scripts/verify-adapters.mjs` parses the shared table and requires a dated row, a section and a probe command per adapter; wired into `pnpm verify`; calibrated both ways (removing the WPS row fails, restoring passes: 7 adapters / 9 bundle ids) |
| T2.0-6, T2.0-7, T2.0-9, T2.0-10, T2.0-11 | open | — |

