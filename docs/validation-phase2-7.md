# Phase 2.7 runtime validation

Companion to `docs/plan-phase2-7.md`. Evidence first, per task. This phase
changes no runtime behaviour: the 306 tests that existed when it started must
still pass unmodified.

## T2.7-0 — the audit, and the holes it found

```text
guard                        lines  self-checks  detects
verify-adapters.mjs             63        0       adapter table vs docs/adapters.md rows,
                                                  sections, probes, bundle ids
verify-privacy-boundary.mjs     96        0       forbidden AX/media APIs in the sources,
                                                  page-content APIs in the extensions
verify-store-protection.mjs    117        0       store path: permissions, sync folders,
                                                  volume, FileVault
verify-semantic-boundary.mjs   111        3       network calls outside the two allowed
                                                  senders, each behind its own check
```

Three of the four guards could not prove they were able to fail, and two further
holes came out of running them rather than reading them:

- **`verify-privacy-boundary` said nothing when it passed.** Success was silent,
  so a guard that never ran and a guard that found nothing looked identical from
  the outside. It now prints what it scanned and what it denied.
- **`verify-store-protection` skipped its permission check** on this machine
  ("store not created yet: … permission checks skipped") and would have said so
  only to someone reading the whole output. The self-check below exercises the
  permission predicate against a directory the test owns, so it is measured even
  when there is no store to measure.

## T2.7-1 — every guard proves it can fail

Each guard now contains a discriminating self-check: a synthetic sample of the
shape it exists to catch, asserted **to match**, and a near-miss asserted **not**
to. The calibration is part of the guard, not a story about one.

```text
red    verify-adapters           no adapter ids were read from the table - this guard proves nothing
green  verify-adapters           adapter evidence complete: 11 adapters, 22 bundle ids (…)

red    verify-privacy            no source files were read - this guard proves nothing
green  verify-privacy            privacy boundary holds: 106 source files scanned,
                                 10 forbidden APIs and 6 content APIs denied

red    verify-store-protection   the sync-folder check no longer recognises a synced path
green  verify-store-protection   store protection holds (ADR 0005): … permissions,
                                 non-synced location, FileVault
```

Each break was a **valid** break of the detection logic (an empty scan root, an
emptied sync list, a pattern that cannot match). My first attempt at two of them
inserted text that made the file a syntax error instead - which fails the guard
for the wrong reason and would have counted as a calibration while proving
nothing. The report keeps that mistake because "it went red" is not the same as
"my check went red".

A fourth guard already had self-checks (semantic boundary, added in 2.6), so
`pnpm verify` now runs five guards that each state what they scanned and can each
be shown to fail.
