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

## T2.2-4 — Work Threads

`src/host/episodes/threads.ts` groups episodes by their `threadKey` (newest
first) into a `WorkThread`: the episode ids, the span, the resources the thread
touched, a deterministic summary, and the union of its episodes' citations —
never more than the evidence supports. `GET /threads?limit=` exposes it and the
panel lists it under **Work threads**.

Live, against the running Host after seeding one threaded episode with two cited
observations:

```text
GET /threads?limit=20
[{"threadKey":"workspace:w1","episodeIds":["ep1"],"episodeCount":1,
  "startedAtMs":1,"endedAtMs":2,"resources":[],
  "summary":"1 episode in demo, touching no resources.",
  "summaryObservationIds":[1,2]}]
```

`pnpm test` → 250, two of them for the builder: episodes sharing a thread key
land in one thread, a thread's citations are exactly its own episodes' (an
episode without a thread key does not donate its citations), and a thread with
no resources says so instead of inventing some.

### Two real defects the live check found

1. **`GET /threads` answered `{}`.** The route handed the *promise* from
   `history.threads()` straight to `json()`, which serialises a promise as an
   empty object — an empty list and a broken route looked identical. The route
   awaits now.
2. **The schema was still at version 2 and the route did not exist at all** on
   the first attempt: the running plugin predated the build, the module-cache
   trap this project has now hit four times. The recipe in
   `docs/verification-guide.md` already says "a live measurement after a build is
   only meaningful after the reload"; this round is the reminder that it applies
   to *every* live check, including a quick one.

## T2.2-5 — a usable resume hint

The hint now names the resource to reopen and the citations behind it, and an
episode without citations cannot produce one at all:

```ts
readonly resource?: ResourceIdentity
readonly citations: readonly [ObservationId, ...ObservationId[]]
```

All six hit paths in the resolver go through one `hitResolution()` helper, which
returns `undefined` when the episode has no citations; the caller then answers
`none` with "the best match has no citations, so it is not a hint". `pnpm test`
→ 252, two new:

| case | expectation |
|---|---|
| a hit from the fixture | `citations` equals the episode's own `summaryObservationIds`, and `resource` is present |
| the same query with every episode's citations removed | `status: 'none'`, reason mentions citations |

### The route collision this task found

The panel's first version posted to `/resume`. That route already means **resume
capture** (`history.resume()`), so the hint would have resumed recording and
returned a body the panel could not render — my POST got `{}` and looked like an
empty hint. The hint now has its own route, `POST /resume-hint`, which validates
the query (400 without one) and awaits `resolveResume` (the same promise-to-
`json()` mistake `/threads` had).

Live, against the running Host:

```text
POST /resume-hint {query: "继续 demo 那个", …}   → {"status":"none"}
POST /resume-hint {}                             → HTTP 400
panel: … | Resume | Find where I left off | …
```

`status: none` was correct: the seeded episode is dated 1970, outside any
recency window.

### Deletion coherence, observed by accident

A later panel read showed the seeded episode with **0 citations**, and the
database agreed: `episode_summary_citations` had no rows and
`episode_observations` was empty. The cause was not a defect. The store was
fresh, its default policy is `include-only` with no rules, so the seeded
`com.microsoft.VSCode` observations were inadmissible and got cleaned up — and
the two `ON DELETE CASCADE` links took the episode's observation links and its
citation rows with them. That is exactly the deletion contract T2.2-6 must prove,
seen once in the wild before its test exists.

## T2.2-6 — deletion coherence

Three tests in `tests/integration/deletion.spec.ts` pin the contract instead of
promising it:

| case | expectation |
|---|---|
| foreign keys after the migration | `PRAGMA foreign_keys` is 1 |
| delete one app's evidence | the episode's citations drop from 3 to 2, the rebuilt episode cites exactly its surviving observations, and a thread computed afterwards inherits only those |
| delete everything | zero citation rows, zero episodes, and `buildWorkThreads([])` is empty |

The first case is the one that makes the other two mean something. Migration
0003 rebuilds `episodes` with `PRAGMA foreign_keys = OFF` — SQLite's documented
procedure, which this project needed because dropping a referenced table cascades
its children — and the runner turns it back on. If that restore ever failed,
deleted observations would quietly leave their citation rows behind and every
"deletion removes derived text" claim would be false while the tests kept
passing. So the state is asserted, not assumed.

## T2.2-7 — the panel, the routes and the documentation

`GET /semantic` reports who produces summaries per scope, `GET
/semantic/preview?scope=` returns exactly what a provider would see,
`POST /semantic/opt-in` records a permission and `POST /semantic/revoke` turns a
scope off and purges its model-written summaries. The panel gained a
**Summaries** section: the active layer, per-scope rows, *Preview payload* and
*Turn off and purge*.

`pnpm test` → 258, four of them new:

| case | expectation |
|---|---|
| purge a workspace scope with one `local` and one `remote` episode beside a `deterministic` one | `purged: 2`, and the deterministic episode survives |
| purge one scope | the other scope's episodes survive |
| `parseScopeKey` | refuses an unparseable key, allows a colon inside an app id |

The purge rule is the one worth stating plainly: **turning a scope off deletes
model-written text and nothing else.** Deterministic text never left the
machine, so there is nothing to withdraw, and deleting *evidence* is a different
contract that `episode_summary_citations` enforces with `ON DELETE CASCADE`.

### Live evidence for T2.2-7

```text
GET  /semantic                {"active":"deterministic","localProviderConfigured":false,"scopes":[]}
POST /semantic/opt-in         {"scopeKey":"workspace:w1","providerKind":"local","createdAtMs":…}
GET  /semantic/preview?scope=workspace:w1     HTTP 404   (no episode in that scope yet)
POST /semantic/revoke         {"revoked":true,"purged":0}
GET  /semantic                {"active":"deterministic","localProviderConfigured":false,"scopes":[]}
```

The panel, read from the real GUI (`/tmp/dsh-panel-21.png`, reviewed):

```text
Browser companion | Listening on 127.0.0.1:19388 · not paired yet |
Summaries | Deterministic summaries are on (nothing leaves this machine).
Local model: not configured; remote: never without a scope opting in. |
workspace:w1 — local  [Preview payload] [Turn off and purge] |
Resume | Find where I left off |
Work threads | No threaded work yet: episodes need a workspace the Host can vouch for.
```

The screenshot shows the same in the shell: the Computer History panel with the
companion box, the Summaries heading and its scope row, the Resume action and the
thread list, above the existing privacy controls. The 404 on the preview is the
honest answer for a scope with no stored episode, and it is what the panel would
show rather than a fabricated payload.
