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
