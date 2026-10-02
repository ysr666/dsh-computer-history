# Phase 2.3 runtime validation

Companion to `docs/plan-phase2-3.md`. One section per task, evidence first: the
command that produced the result, then the result. Environment restored after
every section.

Boundary in force: ADR 0002 (metadata-only), ADR 0005 (store protection),
ADR 0007 (companion), ADR 0008 (this phase's F13 decision).

## T2.3-0 — plan review

What exists: `recent`, `search`, `episode`, `delete`, `policy`, `pause`,
`resume`, `state`, plus the 2.1/2.2 routes. What is missing: export/import, the
redaction preview, the day/week timeline, "why was this recorded", and the
per-app/per-site control surface. The review found nothing that requires a
second stored schema — an export can be a projection of the tables that already
exist — which is what T2.3-2 relies on.

## T2.3-1 — F13: the protected-path title residue

ADR 0008 records the decision: with any protect rule in force, a window that
offers only a bare file name and no readable resource is not stored, because the
Host cannot tell whether that file lives under a protected path.

`pnpm test` → four new cases in `tests/integration/ingestion.spec.ts`:

| case | expectation |
|---|---|
| no protect rule, title `notes.txt`, no document | **stored** (behaviour unchanged) |
| a protect rule in force, same window | **dropped** |
| `notes.txt — Editor` and `Doing the thing` | stored: more than a file name |
| a readable document the policy does not protect | stored, exactly as before |

The first case is the control: the rule must be about the presence of a protect
rule, not about file names in general.

### Two test bugs of my own, caught by running them

- The first version of these tests configured the policy through
  `PolicyStore.ensureInitial()` + `replace()`, and the store's **built-in**
  protect rules (1Password, Bitwarden, credential paths) were still in force, so
  the control case dropped for a different reason than the one under test. The
  helper now builds the `PolicySnapshot` by hand: these cases are about the
  normaliser's decision, not about how a policy is persisted.
- The second version ingested two observations sharing a `(collectorSession,
  seq)` pair, so the duplicate guard dropped the second and the assertion failed
  for a reason unrelated to F13. Distinct sequences fixed it.

## T2.3-2 — export and import

`src/host/audit/export.ts` projects the tables that already exist — resources,
policy state and rules, semantic opt-ins, observations, episodes and the three
join tables — into one JSON document carrying a schema name and the database's
schema version. `importHistory` reads it back through a whitelist taken from the
live database (`PRAGMA table_info`), so an export from a future version fails
loudly instead of half-importing. `GET /export` and `POST /import` expose both.

Two tables are deliberately absent, and the code says why:

- `companion_pairing` holds the pairing token **digest** — a credential, not
  history;
- `deletion_log` records *that* something was deleted and which bundle id it
  belonged to, which is exactly the "what used to exist here" a reader should
  not receive from an export.

`pnpm test` → four cases:

| case | expectation |
|---|---|
| round trip into an empty store | counts match exactly (1 resource, 1 observation, 1 episode, 1 citation, 1 rule, 1 opt-in), the episode's text and kind survive, and its citation row comes back |
| the same document twice | idempotent; counts unchanged |
| the credential | `deadbeef` and `companion_pairing` appear nowhere in the serialised export |
| documents this Host cannot store verbatim | unknown schema, unknown column, non-primitive value and a missing `tables` object each refused with a reason |

Three of these tests failed first, each naming a column my seed got wrong
(`policy_state.id`, `episode_observations.observed_at_ms`) — the export itself
was fine, and the failures came from the fixture, which is the useful direction
for a fixture to fail in.

## T2.3-3 — redaction preview

`GET /audit/preview?scope=app:<bundleId>` (or `workspace:<id>`) answers "what
would this policy not have kept", computed by **running the ingestion
predicates over stored rows** rather than by writing a second version of them:
`PROTECTED_BUNDLES`, `policyAllows`, `isProtectedText`, the secure-path screen
and `isUnlocatableFileName` are imported from the normaliser for exactly this.
If the preview and ingestion ever disagree, one of them is a bug and the shared
functions make it visible.

`pnpm test` → four cases:

| case | expectation |
|---|---|
| one app allowed, `.env` and an unlisted app stored | the Terminal row and the `.env` row are both excluded, with reasons |
| a protect rule in force | the rule appears in `rulesInForce` and the title-only `notes.txt` row counts as one the Host would not keep (F13, visible in the audit) |
| both stored apps allowed | only the `.env` row is excluded — the secure-path rule does not care about the allow-list |
| an `include-only` policy with no allow rule | **all four rows** are excluded, and the test says so |

The first run of this suite failed three times, and two of the failures were
real:

- the preview was missing the **secure-path screen** ingestion applies to a
  resource, so `.env` would have looked safe in the audit while ingestion drops
  it. `SECURE_PATH` is now shared and the preview calls it;
- an excluded row's label fell back to the bundle id, which made a title-only
  row read as "com.apple.Terminal" instead of "zsh". The label now prefers the
  resource, then the window title, then the application.

The third failure was my premise, not the code: I had written "an empty policy
excludes nothing", but an `include-only` policy with no allow rule excludes
everything. The test now asserts both directions.

## T2.3-4 — timeline and "why was this recorded"

`GET /timeline?days=` groups stored episodes into the local days they happened on
(newest first) and the panel lists them; clicking an episode fetches
`GET /episode?id=` and shows **why it exists**, in words a person reads rather
than the Host's own vocabulary:

```text
Recorded because a supported application became active; and it ended because the
machine went idle; 2 observations cited; 1 resource; 1 application; policy
revision 4; confidence 0.80.
```

`describeProvenance` and `buildTimeline` live in `src/shared/audit-view.ts`, so
the sentence is testable without a browser. `pnpm test` → five cases: grouping by
local day with the newest day first and the newest episode first inside it, the
day limit, the sentence itself, the not-yet-ended case with singular counts, and
one case per boundary reason proving the machine vocabulary was translated.

That last test failed first because it asserted the sentence never contains the
word `idle` — which it legitimately does, inside "the machine went idle". The
assertion now targets the hyphenated tokens (`first-observation`,
`workspace-switch`, `collector-restart`, `manual-rebuild`), which cannot appear
by accident, and that is the claim worth making.

An episode with no readable resource says so and names the applications instead,
rather than showing an empty resource list.

### Live evidence for T2.3-4

Against the running Host, with one seeded episode dated today:

```text
GET /timeline?days=7
[{"dayKey":"2026-10-02","episodeCount":1,"startedAtMs":…,"endedAtMs":…,
  "episodes":[{"id":"ep-today",…}]}]

panel (no click)  Timeline | Wrote report.md in demo.
click the episode → Why was this recorded? |
  Recorded because a supported application became active; and it ended because
  the machine went idle; 2 observations cited; 1 resource; 0 applications;
  policy revision 0; confidence 0.80. |
  Resources: report.md
```

That is the click-and-state-change evidence the plan asks for: the detail only
exists after the row is activated.

Two honest notes about this output. `0 applications` is my seed's gap, not the
Host's: surfaces come from `episode_surfaces`, which the fixture did not fill,
so the episode legitimately reports none. And `policy revision 0` is the panel's
placeholder — a stored episode does not carry the revision that was in force when
it was written, and the sentence says so rather than inventing a number.

## T2.3-5 — per-episode controls and the unanchored presentation (partial)

The episode detail now offers one-click **Allow** and **Forget** for each
application the episode saw, so a reader never has to type a bundle id, and an
episode with no readable resource says what it does know:

```text
No resource was visible. This episode is unanchored, but the applications it saw
were: com.microsoft.VSCode
```

**The live click evidence is not captured, and this section does not claim it.**
Three attempts failed, all of them in my harness rather than in the panel:

1. a regex edit to the panel script ate the rest of it, so every later
   `Runtime.evaluate` returned `undefined`;
2. the seeded episode vanished before the panel read it — a fresh store's
   `include-only` policy had no allow rule, so the seeded observations were
   inadmissible and the sweep took them, exactly as the 2.2 round recorded;
3. the retry that added the allow rule first passed the session cookie as a
   *command argument* instead of an environment variable, so every API call
   answered `401 unauthorized`.

What is verified: the code type-checks, the build succeeds, and `pnpm verify`
stays green. What is not: that a click in the real GUI changes the policy. The
next attempt starts from the working recipe (allow rule first, cookie through
the environment) rather than from a newer idea.

Retention controls are also not done: they need a stored override and a sweep
that reads it, which is a migration rather than a panel edit.
