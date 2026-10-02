# Phase 2.7 — Quality and operations

Status: Ready to execute (owner: "代码质量非常非常重要")
Boundary: no behaviour change. This phase changes what the repository can
**prove about itself**, and how it is released.

## The quality bar, stated as things a machine can check

A claim about quality that no command can falsify is a slogan. This phase holds
these, and each one is a gate rather than an aspiration:

1. **Every guard proves it can fail.** A check that matches nothing looks exactly
   like a clean codebase. Phase 2.6 found a guard reporting "1 network call, all
   in local-provider.ts" while two files were sending, and a guard script that did
   not even parse; both passed silently. Each `verify:*` script must contain a
   self-check that it still recognises the shape it exists to catch.
2. **Layering is enforced, not assumed.** `src/shared` is the contract layer: a
   host import from it is a structural bug (the client and the native side both
   depend on it). No `shared → host` import may exist.
3. **No dead contract.** Every exported symbol in `src/shared` is used somewhere;
   an export nobody reads is either a missing feature or a leftover.
4. **Migrations are invariable.** Version numbers are contiguous, checksums are
   unique, and the frozen-v1 upgrade test exercises the newest schema — the
   rebuild path added in 2.4 and 2.6 is exactly where a quiet data loss lives.
5. **The release path is exercised, not documented.** The plugin packs, the
   extension packs, and the packaged artifact installs and starts.

## Exit gate for 2.7

- `pnpm verify` and `pnpm verify:p1` green, with the new checks inside
  `pnpm verify`.
- Every existing `verify:*` guard has a self-check, and each one was demonstrated
  red (temporarily broken) then green.
- The layering, dead-export and migration-invariant checks run in the gate and
  were each calibrated red then green.
- `pnpm pack` produces an installable tarball, and `docs/release.md` states
  install, upgrade and rollback; the packaged plugin is started from the tarball
  once, for real.
- No behaviour change: the 306 tests that existed at the start of the phase still
  pass, unmodified except where a check legitimately needed a new case.

---

## T2.7-0 — audit the quality surface

Inventory every gate (`check`, `verify:privacy`, `verify:adapters`,
`verify:store-protection`, `verify:semantic-boundary`, `verify:p1`) and, for each,
answer three questions: what shape does it detect, what happens if the detector
breaks, and what does it *not* look at. The output is a table of holes, which the
rest of the phase closes in order of how quietly each hole would fail.

## T2.7-1 — every guard proves it can fail

Add a self-check to each guard: a synthetic sample of the shape it exists to
catch, asserted to match. Where a guard already has one (semantic boundary, the
editor extension's forbidden-read check), the self-check becomes uniform and its
own calibration is demonstrated.

## T2.7-2 — layering and dead contracts

A check that no file under `src/shared` imports from `src/host`, `src/client` or
`extension*`, and one that every named export of `src/shared` is referenced from
outside it. Hand-rolled over the source tree - a dependency for two greps would
be a new concept for no new guarantee.

## T2.7-3 — migration invariants

Contiguous versions, unique names and checksums, every `rebuildsReferencedTable`
migration followed by an integrity check (already true in the runner - this makes
it a checked invariant), and the upgrade test asserting the *latest* version, so
a new migration cannot be added without the frozen-v1 path covering it.

## T2.7-4 — the release path

`pnpm store:pack` (or equivalent) producing the plugin tarball, the extension's
`.vsix`, and `docs/release.md` with install, upgrade and rollback. The packaged
plugin is installed and started once from the tarball, with the fiber state as
evidence.

## T2.7-5 — documentation and the phase report

`docs/quality.md` (what the gate proves, and what it deliberately does not),
`docs/validation-phase2-7.md`, roadmap entry.

## Out of scope

Coverage-percentage targets (a number that rewards testing trivia), any change to
runtime behaviour, and the editor companion's generalisation to other editors,
which follows this phase.
