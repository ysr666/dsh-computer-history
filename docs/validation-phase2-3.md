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
