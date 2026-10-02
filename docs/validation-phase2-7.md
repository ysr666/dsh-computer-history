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

## T2.7-3 — migration invariants

`scripts/verify-migrations.mjs` is the seventh guard. Its rules are **derived from
the sources**, not kept in a list somebody has to remember:

```text
migration invariants hold: 7 migrations, versions 1..7, 2 rebuilds behind an integrity check
```

| rule | why it is derivable |
|---|---|
| versions contiguous from 1, names and checksums unique | read from the migration files themselves |
| every file registered in the runner, nothing registered that does not exist | the runner text is compared with the directory |
| **a migration that drops or renames a table must set `rebuildsReferencedTable`** | that flag is what turns foreign keys off around the rebuild and runs `PRAGMA foreign_key_check` before the commit |
| the frozen-v1 upgrade test must **assert** the latest version | otherwise a new migration can be added without that path covering it |

The third rule is the one worth having: a rebuild that forgets the flag is
committed **without** an integrity check, and a cascade that eats linked rows is
exactly what 2.4 found the hard way. Nobody has to remember it now.

```text
red    a migration that drops a table without the flag
       → 0005-retention-settings.ts drops or renames a table without
         rebuildsReferencedTable, so the runner would commit it without a
         foreign_key_check
green  restored
       → migration invariants hold: 7 migrations, versions 1..7
```

### Two of my own checks were too weak, and the calibrations found them

- **Rule 4 accepted a mention as an assertion.** The upgrade test contained
  `PRAGMA user_version = 1` - a line that *sets* the version - and my regex was
  happy with it. The rule now requires the version inside an expectation, the
  guard went red as it should, and the test gained a real assertion computed from
  the migrations directory so a new migration cannot slip past it.
- **My first calibration of rule 3 was not a calibration.** I disabled the
  detector instead of creating a violation, and the guard passed - because a rule
  that only reports what it finds says nothing when it finds nothing. The valid
  calibration inserts an actual `DROP TABLE` into a migration without the flag,
  which is what now produces the red line above.

A third, smaller one: the guard's own self-check helpers tripped the repository's
lint rule about functions that capture nothing, which is the linter asking for the
right thing - they are module-scope probes.

## T2.7-4 — the release path, and the defect it found on the first run

Packing works:

```text
npm pack → dsh-computer-history-0.1.0-dev.0.tgz (295 KB)
tar tzf  → package/{lib,native,scripts,bin,package.json,README*,LICENSE,SECURITY.md}
           lib/index.js present, 0 src files (the whitelist holds)
```

Installing the **packaged artifact** into its own directory and pointing the
profile junction at it - not at the repository - is where the phase earned its
keep:

```text
junction → /tmp/dsh-ch-27-install/package
loader   → [no-fiber] c9d180ef (dsh-computer-history)
```

**The packaged plugin has no fiber: it does not start.** The same tree, loaded
from the repository, is `[active]`. Nothing about the tarball's contents looks
wrong - the entry file is there, no sources leaked in, the manifest is the one
that worked - so the fault is in how the packaged entry is resolved or imported,
and that is not a guess I am willing to write down as a conclusion.

What is established, and what is not:

- **established**: packing produces an installable-looking artifact; installing it
  by hand and loading it yields an entry with **no fiber**; the repository copy at
  the same commit starts normally;
- **not established**: why. The next attempt starts where the 2.6 loader failure
  was diagnosed successfully - `fiber._error` on the created entry - and compares
  the extracted package against the repository (resolution of peer imports is the
  first candidate, since the package has no `node_modules` of its own).

`docs/release.md` therefore documents the install that is **verified** (from a
checkout, with the junction at the repository) and states plainly that installing
the tarball fails to start, with the evidence above. A release document that
described the tarball path as working would be the exact failure mode this phase
exists to prevent.

Environment restored: loader entry removed, junction and `~/.dsh/computer-history`
deleted, `/tmp/dsh-ch-27-install` and the store directory removed, the tarball left
in place for the next attempt.

### T2.7-4, second attempt: the finding stands, and one of my probes did not

Two things were checked, and the record needs both.

**My first probe was unrepresentative.** Extracting the tarball to `/tmp` and
importing the entry with plain `node` fails with
`Cannot find package '@deepseek-ai/dsh-home-paths'` - but a working profile
plugin (`dsh-context`) imports `@deepseek-ai/dsh-session` at runtime too, and the
profile has no such package in its `node_modules`. The Host's loader provides
that resolution itself, so a bare Node import says nothing about whether the
artifact loads. (A symlink into the profile does not help either: Node resolves
the real path first, which is why the error still named `/private/tmp/...`.)

**The finding itself survives a fair test.** Installing the tarball as a real
directory at `~/.dsh/profiles/desktop/node_modules/dsh-computer-history` - the
shape a real install has, with a directory rather than a symlink - and creating
the entry gives:

```text
repo copy, junction → repository      [active]
packaged copy, real profile install   {"fiber":"no-fiber"}
```

So the packaged plugin does not start, twice, in two install shapes; the same tree
loaded from a checkout does. `dsh-context` proves that importing DSH packages from
a profile install is normal, so the cause is something about **this** package.

**The next probe is named, not guessed.** The loader leaves an entry without a
fiber when its import fails, and 2.6 showed where that error surfaces
(`entry._error` / the created entry's fields). The comparison to run is the
extracted package against the repository file by file - starting with what the
`dsh` manifest names: the client entry, the preset, and anything the whitelist
might have dropped even though `lib/` looks complete.

`docs/release.md` will document the checkout install (verified) and state that
the tarball path currently fails to start, with this evidence.

### T2.7-4, third attempt: what is actually different, and what `no-fiber` means

Three probes, each correcting the previous one's reading of the loader API:

```text
loader.create(...) returns the entry ID as a string ("695447a0"), not an entry
  object - my first two accessors were reading indices of that string, which is
  why one of them reported keys "0,1,2,3,4,5,6,7"
the entry found by that id has fiber.state === 'none'
  not 'failed': the fiber exists and never started
the packaged lib/*.js and the manifest are byte-identical to the repository's
```

So the artifact is not different; its **install location** is. And the useful
comparison is with a plugin that works from the same location: `dsh-context`
lives in `~/.dsh/profiles/desktop/node_modules`, imports
`@deepseek-ai/dsh-session` at runtime, ships only `zod` of its own, and runs - so
the Host does resolve DSH packages for profile installs. My package declares them
as `peerDependencies`, which is the same classification.

What that leaves, stated as a hypothesis rather than a conclusion: the fiber is
created and never started, which is the state a fiber holds while the loader is
waiting for something - its dependencies to be injected, or its entry to be
imported. The repository copy resolves `@deepseek-ai/*` through the repository's
own `node_modules`; the profile install has none, and the one third-party plugin
that demonstrably imports a DSH package from that location is `dsh-context`.

**Next probe, named:** dump the entry's own fields with the correct accessor
(`_initTask` came back undefined this time, so it needs the same treatment the
fiber needed in 2.6), and test the peer hypothesis directly by installing the
tarball **with its dependencies** into the profile rather than copying it in, then
reading the fiber state. If the fiber starts, the release document's install
command is the dependency-installing one, and that is what `docs/release.md` will
say.

`docs/release.md` still documents the checkout install as the verified path and
states that copying the tarball in leaves the fiber unstarted, with the evidence
above - the phase's whole point is that a release document says what was measured.

### T2.7-4, fourth attempt: two hypotheses disproven, and the boundary named

The peer hypothesis was tested rather than written down as if confirmed, and it is
**wrong**:

```text
tarball at ~/.dsh/profiles/desktop/node_modules/dsh-computer-history
  with node_modules symlinked beside it (cordis, dsh-agent, dsh-atomic-write)
  → entry created, fiber.state = none      (not 'failed': never started)
then declared in the profile - dependencies += and bundles += the package
  → entry recreated, fiber.state = none again
checkout copy at the same path (junction to the repository)
  → [active]
```

So it is not the missing files (lib and manifest are byte-identical), not the
missing peers (providing them changes nothing), and not the profile declaration
either. What fits is the install tool's own note while doing exactly this:
*"restart 后由 bundles 列表正常装配"* - a package declared in the profile is
assembled **at Host startup**, while the runtime path that starts a plugin is the
development one.

**That is as far as this session can go, and the boundary is the point.** The Host
carrying this GUI is the session itself, so the restart that would settle it is not
something I can perform; and claiming the artifact starts because the declaration
says it will is exactly the failure this phase exists to prevent.

| claim | evidence |
|---|---|
| packing produces a complete artifact | tarball contents, byte-identical `lib/`, manifest match |
| a copy in the profile does not start at runtime | `fiber.state = none`, three ways |
| a checkout install starts | `[active]`, this phase and every earlier one |
| a declared bundle is assembled at startup | the install tool's report, and `none` at runtime |

**Next probe, named:** restart the Host once with the package declared, then read
that entry's fiber state. If it starts, the release document's install step is
"declare it and restart"; if it does not, the artifact has a real defect and
`entry._initTask` is where the error lives - the one accessor my three probes never
managed to read.

`docs/release.md` therefore documents the verified checkout install, states plainly
that the tarball path is not verified with what was measured, and covers upgrade and
rollback - including that a rollback across a migration is not merely a code
revert.

Environment restored: the profile's `dependencies`/`bundles` entries removed, the
installed directory deleted, the patch residue cleared, the store symlink and every
`/tmp/dsh-ch-27*` directory removed, the tarball left in place for the next probe.
