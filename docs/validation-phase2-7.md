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

## T2.7-2 — layering and dead contracts

`scripts/verify-architecture.mjs` enforces two rules a compiler cannot see, and
`pnpm verify` runs it as its sixth guard:

```text
architecture holds: 14 contract files, 83 exports all read, no import escapes the layer
```

**Rule 1 — the contract layer may not import an implementation.** `src/shared` is
what the Host, the client and the extensions agree on; an import from it into
`host`, `client` or `extension*` is a cycle in the dependency graph rather than a
style preference. Zero escapes today.

**Rule 2 — an export nobody reads is a decision nobody made.**
`dead means referenced nowhere, including inside the layer` - a name that appears
only in its own declaration is a leftover; a name that appears in a union the
layer exports is doing work even if no consumer spells it out.

### The rule was too crude on the first pass, and it nearly deleted live code

The first version counted consumers only, and reported eleven "unread" exports. I
acted on it: four types lost their `export`, and **seven protocol message types
were deleted** as leftovers. Then `pnpm typecheck` refused to compile, because
those seven are members of an exported union - the name never appears outside the
layer, but the union does, and the union is the contract.

The check was wrong, not the code. Restoring them all and refining the rule to
"referenced nowhere at all" leaves `83 exports all read`, and the four
un-exports were reverted too: `Brand` is used by `ids.ts` itself, `ProvenanceInput`
by the signature that takes it, `EpisodeBoundary` and `EpisodeWorkspaceSummary` by
`EpisodeSummary`. A check that proposes deleting live code is checking the wrong
thing, and the honest response is to fix the check rather than keep the tidy-looking
diff.

### A self-check that counted itself

The dead-export probe asserts that a name appearing nowhere is reported as used.
It failed immediately, because the guard's own source was part of the consumer
corpus and therefore contained the synthetic name. The corpus now excludes the
guard itself, which is the same class of mistake this phase exists to catch: a
check whose evidence comes from the thing it is checking.

### Calibration

```text
red    layering matcher replaced with one that cannot match
       → the layering rule no longer catches an escape - this guard proves nothing
red    dead-export threshold raised so every export looks dead
       → RecentEpisodesRequest (exported by src/shared/api.ts, referenced nowhere) …
green  both restored
       → architecture holds: 14 contract files, 83 exports all read
```

`pnpm verify` → 306 tests unchanged, lint 0 warnings, and six guards that each
state what they scanned.
