# Phase 2.2 runtime validation

Companion to `docs/plan-phase2-2.md`. One section per task, evidence first: the
command that produced the result, then the result. Environment restored after
every section.

Boundary in force: ADR 0002 (metadata-only), ADR 0004 (semantic enrichment),
ADR 0007 (companion).

## T2.2-0 — spike: is there a local model path?

| Check | Result |
|---|---|
| `command -v ollama` | no |
| `command -v llama-cli` | no |
| `command -v mlx_lm.server` | no |
| `command -v llamafile` | no |
| `command -v lms` (LM Studio) | no |
| `curl 127.0.0.1:11434/api/tags` | nothing listening |

No local model runtime exists on this machine, which is the condition ADR 0004's
own Consequences section predicted. Semantic summaries therefore stay **off** and
per-scope (ADR 0004 §2); the local provider becomes default-on for a scope only
once one is configured (§3). 2.2 is planned as deterministic enrichment +
threads + resume first, the provider seam and its guard rails second, remote
last and blocked by construction.

## T2.2-1 — summary provenance and citations

`EpisodeSummaryKind` is now `deterministic | local | remote` (ADR 0004 §5) and
every summary carries `summaryObservationIds`, the observations it was derived
from.

- Migration 0003 widens the `summary_kind` CHECK constraint and adds
  `episode_summary_citations(episode_id, observation_id)` with `ON DELETE
  CASCADE` on both sides, so the database itself ties a summary to stored
  evidence.
- The deterministic builder cites the episode's own observations; the store
  writes the citations on every upsert (replacing them wholesale, because a
  stale citation would claim support the summary no longer has) and reads them
  back with the detail.
- `pnpm test` → 242, three of them new:

| case | expectation |
|---|---|
| `deterministic`, `local`, `remote` | accepted by the schema |
| `model` (the old vocabulary) | `CHECK constraint failed` |
| a citation of an observation that does not exist | `FOREIGN KEY constraint failed` |
| deleting the observation | its citation row disappears |

### A real defect this task found

The first version of migration 0003 dropped `episodes` and renamed the rebuilt
table. `episode_observations` and `episode_resources` reference `episodes`, so
with foreign keys enforced the drop **cascades their rows away** — the migration
would have silently deleted history. The frozen-v1 upgrade test
(`upgrades a frozen v1 fixture without losing history`) failed and named it.

The fix follows SQLite's documented rebuild procedure: the migration declares
`rebuildsReferencedTable`, the runner turns `PRAGMA foreign_keys` off around
that migration's transaction (the pragma is a no-op inside one) and runs
`PRAGMA foreign_key_check` before committing, refusing to commit a database with
any violation. The upgrade test passes again with its history intact.

## T2.2-2 — provider seam and minimisation

`src/host/semantic/` holds the seam: `provider.ts` (the interface, the loopback
assertion and the scope key), `minimise.ts` (what a provider may see),
`local-provider.ts` (an Ollama-compatible loopback provider) and `opt-in.ts`
(the per-scope permission). No remote provider exists: the type allows it, the
guard forbids it without an opt-in, and nothing constructs one.

`minimiseEpisode` keeps shape and drops identity:

```json
{"appBundleIds":["com.google.Chrome","com.microsoft.VSCode"],
 "surfaceKinds":["browser","editor"],"resourceKinds":["file","url"],
 "fileExtensions":["ts"],"observationCount":2,"startHourOfDay":9,
 "durationMinutes":90,"workspaceRootName":"secret-client","hasThread":true}
```

From an episode holding `file:///Users/someone/Projects/secret-client/src/billing.ts?token=1#l2`,
`https://internal.example.com/private/invoice?id=7` and the title
`Worked in secret-client on billing.ts`, the payload contains none of the full
path, the file name, the host or the query string. The workspace root **basename**
is kept, which ADR 0004 §4 explicitly allows; the test asserts that too, so the
allowance is visible rather than accidental.

Two real defects came out of the tests rather than the review:

- `URL.hostname` keeps the brackets around an IPv6 literal, so `http://[::1]:11434`
  — a perfectly good loopback endpoint — was refused as remote. The host is now
  unbracketed before the comparison.
- my first expectation listed the project basename as a leak. It is not: ADR
  0004 §4 permits the workspace root basename, and the test now pins it as
  allowed while still forbidding the full path.

## T2.2-3 — opt-in record and the guard

Migration 0004 adds `semantic_opt_ins(scope_key, provider_kind, model,
created_at_ms)`; `assertRemoteOptIn` throws unless that scope has a `remote`
row, and `providerKindAllowed` exposes the same decision for the panel.
`local` and `deterministic` need no consent because nothing leaves the machine.

`scripts/verify-semantic-boundary.mjs` (wired into `pnpm verify`) reads the code:

```text
semantic boundary holds: 1 network call(s), all in local-provider.ts, all loopback-checked (4 files scanned)
```

Three rules: only `local-provider.ts` may contain a network call, it must check
its endpoint with `assertLoopbackEndpoint`, and any file that can construct a
remote provider must call `assertRemoteOptIn`.

The first version of the guard reported "0 network call(s)" and passed — the
detector did not recognise `this.fetchImpl(` and was proving nothing. It now
recognises the injected-fetch shape **and fails when it finds no sender at all**,
because a boundary guard that matches nothing is the same as no guard.

Calibrated in both directions:

```text
opt-in.ts + await fetch("http://example.com")
  → src/host/semantic/opt-in.ts:101: network call outside local-provider.ts   (exit 1)
restored
  → semantic boundary holds: 1 network call(s) …                              (exit 0)
```
