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

## T2.0-9 / T2.0-10 / T2.0-11 — trust base

Measurements taken before deciding (ADR 0005): `fdesetup status` → `FileVault
is On.`; store directory `0700`, `history.sqlite` `0600`; search is a `LIKE`
substring over `summary_text`, `primary_workspace_id`, `primary_workspace_title`,
`canonical_uri` and `display_label`. The search shape is what rules out
field-level encryption inside Phase 2.0: encrypting those columns breaks the
panel's and the agent tools' substring search, and a searchable-index design is
its own project.

Decision: depend on full-volume encryption, enforce it, and say so. Enforced by
`scripts/verify-store-protection.mjs`, wired into `pnpm verify`:

```text
store protection holds (ADR 0005): /Users/ysradmin/.dsh/computer-history — permissions, non-synced location, FileVault
```

Calibrated from both sides, because a check that cannot fail is decoration:

- a `0755` directory with a `0644` `history.sqlite` → exit 1 with both
  violations named;
- a path inside `Library/Mobile Documents` (iCloud Drive) → flagged as a synced
  location, and the check does not require the directory to exist (the `mkdir`
  was refused by macOS and the check still worked);
- the default path → passes.

`docs/threat-model.md` records what the store holds, what eight adversaries
learn, and the residual risks that remain accepted (a session-local attacker
reads everything; titles are descriptive text; the sync-location check is
textual and covers documented locations). `SECURITY.md` links it and states
that `pnpm verify:store-protection` enforces the permission, location and
FileVault requirements.

## T2.0-7 — workspace-less fragmentation (real defect found and fixed)

The metric tool (`scripts/verify/episode-stats.mjs`) run against the real
Cursor store showed the symptom before anything was changed:

```text
stored:             observations 2  episodes 2  unanchored 100%  fragmentation 100%
replayed through the fixed builder:
                    observations 2  episodes 1  unanchored 100%  fragmentation 0%
```

Root cause: for an observation that carries a resource but no *strong*
workspace (`hasStrongWorkspace` requires `dsh`/`git`), the builder closed the
active episode and started a new one unconditionally, with the boundary
labelled `workspace-switch` although no workspace had ever been observed. The
same file, 5.9 seconds apart, became two episodes. This is the common case:
anything outside a DSH workspace (a file in `/tmp`, on the Desktop, in
Downloads).

The fix continues the episode when the resource is the same and the episode has
no workspace to contradict it; a *different* resource still starts a new episode
(per-resource episodes are the documented model, and the counter-case test pins
it). 212 tests green, ingestion benchmark green, and the real-store replay above
is the acceptance evidence.

Two things this section deliberately does not claim:

- **"Unanchored" means "no workspace on the episode", not "no resource"** — the
  client renders `episode.workspace?.title ?? 'Unanchored activity'`. The real
  Cursor observations *did* resolve a `filesystem` workspace
  (`/private/tmp/dsh-live-fixtures`, confidence 0.4), but a non-strong
  observation starts its episode with `owned=false`, so the episode keeps no
  workspace. Whether to label such an episode with the weak workspace is the
  remaining decision for T2.0-7; it changes what the panel shows, so it is
  recorded rather than assumed.
- The VS Code store shows `observations in episodes 1/3` because its two
  document-less observations are evidence-only by design (see T2.0-5). That is
  not a regression from this change.

The first lint run after the change reported one warning
(`unicorn/prefer-set-has` in the new metric script); it was fixed rather than
left, since the repository's baseline is zero warnings.

## T2.0-6 — Cursor Agents window: reviewed, no attribute added

The review question was whether a metadata attribute on a descendant of the
Agents window (a web area's document/URL) could supply the active file. The
evidence already collected says the window itself reports no document while the
same application's classic editor window reports `file:///…/sample.html`
(Phase 1 report §13 and the Cursor end-to-end store), and the Agents surface is
a chat-like view rather than a file view.

Decision: do not add the read. ADR 0002 requires a demonstrated need before the
collector touches a new Accessibility attribute, and here the application's own
window says there is no document — reading deeper would widen the AX surface for
a case the product already handles (title-only observation, resource list in the
panel, aggregation rule from T2.0-7). `bin/verify/ax-probe <pid> 1 --attributes`
is the tool to revisit this if Cursor starts exposing a document.

## T2.0-7 — weak-workspace labelling: decision

The metric tool showed the observations in the real Cursor store resolved a
`filesystem` workspace (`/private/tmp/dsh-live-fixtures`, confidence 0.4) while
their episodes had none, because only `dsh`/`git` workspaces own an episode.

Decision: keep that rule. Replacing "Unanchored activity" with a weak path such
as `/tmp` or `/private/tmp/...` would be a *less* informative headline, and the
panel card already lists the observed resources, so the user still sees which
files were open. The alternative (label episodes from the weak workspace) is
recorded rather than taken, because it also changes resume scoring, which keys
on the episode workspace.

## T2.0-7 — live end-to-end verification (and a trap worth recording)

The pure-builder test and the real-store replay were not enough: a live run
with the plugin injected produced **three episodes for three observations of the
same file**, which looked like the fix failing. Two checks settled it:

1. the running instance predated the fix. The plugin was loaded at 19:17, the
   fixed bundle was written at 19:21:57, and Node's module cache keeps the
   already-imported copy. Verifying that the *file on disk* contains the fix
   says nothing about the *process that is running*;
2. an integration test driving the real `IngestionService` (a filesystem
   workspace, three observations of one resource, 5.9s and 9.1s apart) passes
   with one episode and three observation ids, so the service path was fine.

After `dev_reload_package dsh-computer-history` (cache cleared, fiber rebuilt),
the same live cycle produced the before/after pair inside one store:

```text
pre-reload   session C6C5A1F5…  episodes :3  :4  :5   each with 1 observation
post-reload  session 6E5B6072…  episode  :1          with observations 1,2,3
```

Lesson for the next live verification: a plugin code change needs a hot reload
before any live measurement means anything.

## Phase-level review of the 2.0 diff

Reviewed the whole phase diff (`git diff cdab284..HEAD`, 33 files, 2440
insertions; production code is 5 files and 214 insertions: the native registry,
the shared adapter table, the union member, `normalize.ts` and the builder).
Two places were checked adversarially rather than by running the tests:

- **The continuation rule is deliberately app-agnostic.** It requires the same
  resource, not the same application, so editing a file in one editor and
  previewing it in another stays one episode. That matches the existing strong
  (dsh/git) path, which already continues across *different* resources inside
  one workspace, so the new rule is the stricter of the two.
- **The new store gate runs inside `pnpm verify`.** On a Mac whose store is fine
  but whose FileVault is off, the normal build gate now fails. That is the
  intent of ADR 0005 — the failure names the reason and the ADR — and it skips
  with a message on other platforms. It is a decision an operator can see, not
  a silent degradation.

Residual risks the review did not remove (recorded, not hidden):

- `scripts/verify-adapters.mjs` parses the adapter table textually. If the table
  is reformatted it fails loudly ("no adapters parsed") instead of passing
  silently, so the failure mode is safe but the parser needs updating with the
  format.
- The metric tool (`episode-stats.mjs --replay`) compiles the episode module on
  demand with the repository toolchain; it is a verification tool, not part of
  the gate, so a toolchain change can break it without breaking the build.

## T2.0-2 — JetBrains family, option C (ADR 0006 accepted)

Implemented the per-adapter declaration: `.unqueryable` is its own secure-field
state, `Phase1Adapter.focusedElementPolicy` is part of the table on both sides
and compared by the repository guard, and the collector tolerates an
unqueryable element **only** for a `windowOnly` adapter, recording window
metadata without element fields. The `jetbrains` adapter covers the IntelliJ
family (10 bundle ids).

**Collector level** (fixtures claiming `com.google.android.studio`):

```text
plain  → {"adapter":"jetbrains","privacy":{"secure":false},"title":"dsh-fixture-plain","element":{"role":"AXTextField"}}
secure → {"adapter":"jetbrains","privacy":{"secure":true,"reason":"secure-field"}}   (no title, no element)
```

**Host level**, the condition ADR 0006 requires:

```text
control (plain field)  → jetbrains rows 0 → 2
required (secure field) → jetbrains rows 2 → 2   (0 new rows)
```

The control is what makes the second number evidence: without it, "0 rows"
could equally mean the fixture never ran — which is exactly what happened on
the first attempt.

**Real application:** Android Studio stored four observations
(`Welcome to Android Studio`, `element_role = AXButton`, no resource), i.e. the
adapter works end to end for the real platform. The *unqueryable* state that
motivated the policy did not reproduce (12 samples over a cold start all read a
normal `AXButton` with 23 attributes), so no stored row carries
`reason = focused-element-unqueryable`; that is recorded rather than papered
over.

### Two real defects this task found

1. **A copied adapter list in the store validator.**
   `src/host/store/observation-store.ts` validated `source.adapter` against a
   hardcoded `generic|vscode|terminal|preview|finder`, so every observation
   from `xcode`, `word`, `wps` and `jetbrains` was rejected with
   `invalid observation adapter` — invisible to collector-side probes, which
   never reach the store. The list now derives from `PHASE1_ADAPTERS`, and
   `tests/integration/ingestion.spec.ts` ingests one observation per table
   entry. Calibrated: restoring the copied list makes that test fail with
   `invalid observation adapter: xcode`.
2. **A copied bundle list in the fixture builder.**
   `scripts/verify/fixtures/build-fixture.mjs` refused to build a fixture for
   `com.google.android.studio` because its own list was stale, which silently
   turned a privacy test into "the fixture never ran". It now derives the list
   from the shared table.

### Three traps worth naming

- `POST /policy` answered 400 `cannot capture unsupported app bundle` because
  the *running* plugin still had the previous build: `pnpm build` had not been
  run after the table change. The policy validator was right; the process was
  stale.
- The live run only becomes meaningful after `pnpm build` **and**
  `dev_reload_package` — the module cache otherwise keeps executing the old
  plugin, as an earlier section already recorded.
- Both of this section's false starts (stale fixture builder, stale plugin)
  produced "0 rows", which is indistinguishable from a passing privacy result
  unless a control runs beside it.

## T2.0-4 completion — Word, WPS, Notes, Obsidian

| adapter | measured shape |
|---|---|
| `word` | `document=file://…/sample.rtf`, readable focused element (`AXSplitGroup`) |
| `wps` | no document (`-25212`), title only |
| `notes` | readable element (`AXTextArea`), no document, no `kAXURL`; measured on the owner's running instance and the title value was deliberately not recorded anywhere |
| `obsidian` | Chromium shape (`-25212` on the focused element), title readable, document empty on the vault picker |
| `jetbrains` | real IntelliJ IDEA CE 2025.3 (`com.jetbrains.intellij`) produced an observation with no document and an empty startup title |

Downloads: Obsidian came through the Homebrew **cache**
(`brew fetch --cask obsidian`, 228 MB) rather than the GitHub release, whose
v1.13.8 tag carries only an `.apk`; the cache entry and the mounted image were
removed afterwards. IntelliJ IDEA CE 2025.3 was a 1.4 GB download, also removed
after the measurement. Notes needed no download (the owner already had it
open — that instance was left running, not quit).

Two measurements that are *not* claims:

- Obsidian's window document was empty because only the vault picker was on
  screen; whether opening a note populates the document is still unmeasured, and
  the adapter row says so.
- The IntelliJ unqueryable state did not reproduce in either the Android Studio
  or the IntelliJ IDEA run, so no stored row carries
  `focused-element-unqueryable`; the window-only tolerance rests on the fixture
  pair.

## Pending in 2.0

`T2.0-2` is the only task without a completed deliverable, and it is blocked on
a decision rather than on work: ADR 0006 (Proposed) asks whether an application
whose focused element is not queryable at all (the IntelliJ family returns
`-25202` for role, subrole *and* the attribute list while its window reads fine)
may be recorded `window-only`. Until the owner decides, the conservative
fail-closed behaviour stays and no JetBrains adapter is added.

Exit gate status: `pnpm verify:p1` green, `pnpm verify` green (210 tests,
`verify:privacy`, `verify:adapters` with 7 adapters/9 bundle ids,
`verify:store-protection`), ADR 0005 Accepted and enforced, threat model
written and linked.
