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

### T2.3-5, second attempt: the click is still unverified, and a real lead

The recipe that works (allow rule first, cookie through the header, a seed script
that is not edited by regex) got further: the timeline listed the seeded episode
and clicking it rendered the provenance sentence. The per-application **Allow**
and **Forget** buttons did not appear, and the detail read `0 observations cited;
1 resource; 0 applications`.

My first explanation — "the sweep took the seeded observations, as in 2.2" — is
**wrong**, and one query says so:

```text
observations            2
episode_observations    2
episode_summary_citations 0     ← mine, gone
episode_surfaces          0     ← mine, gone
episodes                  1
deletion_log              (empty)
```

Nothing was deleted. The observations and the episode's links to them are still
there, and no deletion was recorded. What vanished is exactly what I had written
into the two *derived* tables, which is the signature of the plugin's periodic
episode rebuild calling `episodes.replace()` for an episode it did not build
itself: that path rewrites the citations (wholesale) and the surfaces (by
replacement) from what its own builder state knows, which for a seeded episode is
nothing.

That is a **defect lead, not a harness problem**, and it is the same class the
2.2 deletion tests cover — except those seed through the store and never run the
plugin's timer, so they cannot see it. The next round investigates it as a
defect first (a rebuild that empties a summary's citations makes the summary
look unsupported while its evidence is intact), and only then finishes the click
evidence for T2.3-5.

Net state of T2.3-5: the controls are implemented and type-checked; the click
that changes the policy is still **not** verified; retention controls are still
**not** implemented.

### The rebuild lead, narrowed by elimination

I did not chase this live. Instead I enumerated every writer of the two tables
that were emptied, because guessing at a store writer is how a wrong fix gets
written:

| Question | Answer |
|---|---|
| Is `episode_summary_citations` written anywhere but `EpisodeStore.replace()`? | No |
| Is `episode_surfaces` written anywhere but `EpisodeStore.replace()`? | No |
| Who calls `replace()`? | `ingest()` when its builder advances an episode, and `DeletionService` |
| Did deletion run? | No — `deletion_log` is empty |
| Are the observations and their episode links intact? | Yes — 2 and 2 |
| Is `reseed()` a writer? | No — it only rebuilds the in-memory builder from replayable observations |

So the rows went through `replace()` without a deletion, which means either the
ingest path replaced an episode it does not own, or `replace()` deleted rows for
an id it was not given. Both are defects of the same class, and the second would
also explain why `episode_observations` survived while the two tables
`replace()` writes did not.

I tried to settle it with a deterministic test — seed a foreign episode with
citations and surfaces, run one `reseed()` and one `ingest()` for a different
session, and assert the foreign episode is untouched. The test did not get that
far: `ingest()` returned `false` for a message my policy should admit, so the
experiment ended on a question about my own fixture rather than about the
rebuild. The file was removed rather than left skipped; a skipped test asserts
nothing and still looks like coverage.

The next attempt starts there: find out why `ingest()` refused that message
(the guard list is short — a duplicate collector sequence, a normaliser refusal,
a canonicalisation failure, or a resource that looks protected), then let the
same test answer the rebuild question. The finding is written down here so it is
not rediscovered as a surprise.

### The refusal question, answered — and my hypothesis disproved

**Why `ingest()` refused that message.** Not the normaliser: calling
`normalizeObservation` directly on the same message and policy returns a valid
observation with `resource=file:///tmp/demo/report.md`. The service refused it one
step later, in `canonicalizeResource`: the fixture's file **did not exist on
disk**, `realpath` failed, and macOS makes both `/tmp` and `/var` symlinks — so
the existing prefix *is* a symlink, the canonical target is unknown, and the
ingestion path fails closed rather than persist a resource it cannot place under
its real name. That is the behaviour 2.0 recorded, met by a fixture that pointed
at a path nobody had created.

**The hypothesis is disproved.** With a real file in a real directory, the
isolation test runs to the end and **passes**:

```text
tests/integration/rebuild-isolation.spec.ts (1 test) ✓
  a foreign episode keeps its 2 citations and its 1 surface
  through one reseed() and one ingest() of another session's observation
```

So the ingest path does **not** disturb an episode it does not own, and the
earlier "replace deleted rows for the wrong id" reading is wrong. The test stays:
it pins a real invariant, and it is the reason not to go looking for that bug
again.

**What the live vanishing is, then.** The remaining difference between the test
and the live case is the one the refusal question exposed: the live seed used a
`file:///tmp/...` resource whose file never existed, so the row was written by raw
SQL into a state the ingestion path would never produce — and something in the
running plugin's periodic work reacted to an episode whose resource cannot be
canonicalised. That is the lead for the next round, and it is now a question
about the *sweep and repair path with an unresolvable resource*, not about
`replace()`.

### T2.3-5, third attempt: the buttons render, the state change is still unproven

The right recipe fixed the two earlier blockers. A **real file on disk** matters
because the ingestion path canonicalises a file resource and fails closed when an
existing prefix is a symlink — and macOS makes `/tmp` and `/var` symlinks — so a
seed pointing at a path nobody created is a seed the pipeline would never
produce. With `.verify-scratch/report.md` created for real, and the allow rule in
place *before* seeding:

```text
timeline        Timeline | Wrote report.md in demo.
click episode   CLICKED
detail          Why was this recorded? | Recorded because a supported application
                became active; and it ended because the machine went idle;
                2 observations cited; 1 resource; 1 application; policy revision
                0; confidence 0.80.
controls        Allow com.microsoft.VSCode | Forget com.microsoft.VSCode
click Allow     CLICKED
```

So the per-episode controls **do** render — the piece that was missing in the two
earlier attempts — the detail's counts are real (2/1/1), and a click reaches the
panel's own action path.

**What is still not proven is that a click changes stored state**, and the reason
is my own setup: the app was already allowed before the click, so "clicked Allow"
and "did nothing" produce the same policy. The variant that would decide it —
clicking **Forget** — left the policy at revision 4 with the rule still `allow`
and no entry in `deletion_log`; and my own output filter (`controls|forget|saved`)
hid that run's click line, which is labelled `allow:`, so I cannot even say from
that log whether the click fired.

The next attempt is therefore a clean one: keep the allow rule long enough to
seed, then click **Forget** and show the rule disappear or the deletion appear,
not filtered by a grep that was written for a different script. Until then the
click evidence stays **unproven**, and this section says so.

### T2.3-5, fourth attempt: the click changes state — captured

Same recipe, and this time the observable was chosen before the run instead of
after it. `forgetApp` removes the application's rules and then asks for its
history to be deleted, so the deciding observables are the policy revision and
`deletion_log` — read from outside the page, never from the panel's own account
of itself:

```text
policy before      rev2  app:com.microsoft.VSCode
panel              timeline: Wrote report.md in demo.
                   click episode: CLICKED
                   detail: 2 observations cited; 1 resource; 1 application
                   controls: Allow com.microsoft.VSCode | Forget com.microsoft.VSCode
                   click: CLICKED
policy after       rev3  app:com.microsoft.VSCode
deletion_log       (empty — correct: Allow does not delete anything)
```

**The revision moved 2 → 3 because a button in the panel was clicked.** That is
the click-and-state-change evidence T2.3-5 asks for, and it is the first attempt
where the number I would judge by was written down before the run.

The run that produced it clicked **Allow**, not Forget — the script's own label
still says `allow:` and I had only redirected its screenshot path this time. The
rule id is unchanged because the application was already allowed, so the honest
statement is: the click reached the policy and moved its revision; what this run
does not show is a *rule* appearing or disappearing. The Forget variant that
would show that is still unrun, and the reason the earlier one changed nothing is
now clear — that attempt clicked a pattern my `sed` had rewritten, and its output
was filtered by a grep written for a different script.

T2.3-5 remaining: retention controls (a stored override plus a sweep that reads
it), and the Forget-direction proof if the rule-appearing/disappearing statement
is wanted.

## T2.3-5 — retention controls

`GET /retention` answers with the choice in force (or the built-in default) and
`POST /retention` sets it; the panel shows both numbers and a Save button. The
choice is stored in `retention_settings` (migration 0005), not in a
configuration file a later default could quietly flip.

**What the control means is stated rather than implied.** The sweep deletes by
the `expires_at_ms` written when an observation was inserted, so the setting
decides the TTL *stamped on what is recorded from now on*. Shortening the window
does not reach back and delete history the user did not ask to delete — and the
panel says exactly that next to the inputs, because a retention control that
silently deleted old rows would be a deletion the user never requested.

`pnpm test` → four cases: the default is answered before any choice is made; a
choice is remembered and survives being set twice; out-of-range values (0, 721,
0 days, 366 days, a fraction) are refused and leave the default untouched; and
the chosen window is **stamped on what is recorded next** — a 12-hour setting
produces an expiry twelve hours out, strictly less than the built-in
twenty-four.

### A parameter placed in the middle broke fifteen tests

I added the retention provider to `IngestionService` as the fourth constructor
parameter. The constructor already had a fourth parameter — `now` — so every
caller that passed a clock positionally now fed it to the retention window
instead, and fifteen tests across the hardening suite failed: ingests refused,
episodes not re-derived, one test timing out. The gate caught it immediately;
the fix is the parameter at the end, with a comment saying why, because the next
person to add one will face the same trap.

### The plugin failed to load, and the error text found it

The retention change took the whole plugin down: the fiber went `active → failed`
on reload. I did not guess at it. Three probes, each narrower than the last:

1. `ctx.loader.create(...)` inside a try/catch returned **no** error — the failure
   is asynchronous, so the loader marks the fiber failed after setup;
2. the reload log and the super-injector debug log carried no stack;
3. dumping the loader entry's fields showed `fiber._error` — a field I had not
   looked at — and one call later the cause was in plain text:

```text
Error: connection: exact Fetch route "/api/computer-history/retention"
is already registered
    at registerHistoryApi (/…/dsh-computer-history/lib/index.js:3938)
```

I had registered `/retention` **twice** — once for GET and once for POST — and the
connection registry keys routes by exact path, so the second `register()` threw
during setup. It is now one registration with `methods: ['GET', 'POST']` and the
dispatch inside, with a comment saying why, because the next person to add a
second method to a route will reach for the same shape.

That the route-set test stayed green is itself the finding: it compares a sorted
list of paths against a **stub** registry that never rejects a duplicate, so the
real registry is the only place this can fail. Left as a note rather than a
silent gap: a guard would need the real registration path, not the stub.

A second, smaller defect came out of the same round and is committed separately:
the plugin still handed the retention provider to `IngestionService` as the
fourth argument, which is the clock after I moved the new parameter to the end.

### T2.3-5 — retention, verified live

```text
GET  /retention        {"observationRetentionHours":24,"episodeRetentionDays":30,"updatedAtMs":0}
POST /retention        {"observationRetentionHours":6,"episodeRetentionDays":14,"updatedAtMs":1790948888780}
POST observationHours=0    HTTP 400
panel                  Raw observations are kept for 6 hours and episodes for 14 days.
                       A change applies to what is recorded from now on; it does
                       not delete history you already have.
                       Observation hours 6   Episode days 14   [Save retention]
click Save retention   CLICKED
GET  /retention        {"observationRetentionHours":6,"episodeRetentionDays":14,"updatedAtMs":1790948899933}
```

The revision that matters is `updatedAtMs`: it moved because a button in the
panel was clicked, and it was read from the API rather than from the panel's own
account of itself. The screenshot is `/tmp/dsh-panel-retention.png`.

So T2.3-5 is complete: the controls render, the per-application click moves the
policy revision (2 → 3, round 9), the retention click moves `updatedAtMs`, and
the retention semantics — from now on, not retroactive — are stated in the panel
next to the inputs.
