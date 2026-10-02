# Phase 2.2 — Task list (semantic layer)

Status: Ready to execute (owner said continue, 2026-10-02)
Boundary: ADR 0002 (metadata-only), ADR 0004 (semantic enrichment boundary),
ADR 0007 (companion). All three stay in force.

Goal: make an episode answer "what was I doing" with evidence a reader can
check — without pretending a model ran.

## Spike result (T2.2-0, 2026-10-02)

**No local model runtime exists on this machine.** `ollama`, `llama-cli`,
`mlx_lm.server`, `llamafile` and `lms` are all absent, and nothing answers on
`127.0.0.1:11434`. Per ADR 0004 §2 the semantic path therefore defaults to
**off**, per scope; the local provider becomes default-on for a scope only once
one is configured. This is the condition ADR 0004's own Consequences section
predicted, so 2.2 is planned as: deterministic enrichment + threads + resume
first (real value today), the provider seam and its guard rails second (safe the
moment a local model is installed), remote last and blocked by construction.

## Exit gate for 2.2

- `pnpm verify` and `pnpm verify:p1` green, with a new guard proving no
  non-loopback summary request can be issued without a recorded per-scope
  opt-in.
- Every summary, thread and hint carries citations to observation ids; a
  summary without citations fails a test.
- Deleting evidence deletes or rebuilds everything derived from it (proved by
  test, not by promise).
- The panel shows per scope which provider produced the summaries and offers
  "turn off and purge" in one action.
- `docs/validation-phase2-2.md` records each task with commands and results.

---

## T2.2-1 — Summary provenance and citations

**Write scope:** `src/shared/episode.ts`, `src/host/episodes/summary.ts`,
`src/host/store/episode-store.ts`, tests.

**Deliverable:** summaries gain `summaryKind` (`deterministic` | `local` |
`remote`) and the observation ids they were derived from; the deterministic
builder fills both.

**Acceptance:** a summary with no citations is rejected by the type and by a
test; stored summaries read back with their kind and citations intact.

## T2.2-2 — Provider seam and minimisation

**Write scope:** `src/host/semantic/{provider.ts,minimise.ts,summarise.ts}`,
tests.

**Deliverable:** a `SummaryProvider` interface; a `deterministic` provider that
uses the existing builder; a `local` provider speaking Ollama-compatible HTTP on
loopback only, inert unless configured; `minimise(episode)` producing the exact
payload a provider would see.

**Acceptance:** the minimised payload contains no file path, no window title and
no URL with a query string (test); the local provider refuses a non-loopback
endpoint (test); with no provider configured, nothing is sent anywhere.

## T2.2-3 — Opt-in record and the guard

**Write scope:** policy state, `src/host/semantic/opt-in.ts`,
`scripts/verify-semantic-boundary.mjs`, `package.json`.

**Deliverable:** per-scope opt-in rows (`workspace` / `app`), a payload preview
API for the current scope, and a guard that fails if any summary request can be
issued without an opt-in for that scope.

**Acceptance:** guard calibrated in both directions (with and without the
opt-in); the preview endpoint returns exactly `minimise()`'s output.

## T2.2-4 — Work Threads

**Write scope:** `src/host/episodes/thread-key.ts`, a thread store/view,
`src/host/api/routes.ts`, panel.

**Deliverable:** episodes grouped by `threadKey` into threads with a
deterministic summary and citations, newest first, with the resources they
touched.

**Acceptance:** two episodes sharing a resource land in one thread; a thread's
summary cites only its own episodes; the panel lists threads.

## T2.2-5 — Usable ResumeHint

**Write scope:** `src/host/resume/*`, API, panel.

**Deliverable:** a hint that names the episode, the resource to reopen, the
reason it matched, and the citations behind it, with one action in the panel.

**Acceptance:** resolving "resume X" returns a hint whose citations resolve to
stored observations; a hint with no citations is impossible; the panel action is
visible in a screenshot.

## T2.2-6 — Deletion coherence

**Write scope:** `src/host/retention/*`, `src/host/store/*`, tests.

**Deliverable:** deleting observations deletes or rebuilds every derived
summary, thread and hint that cited them.

**Acceptance:** a test deletes the evidence behind a summary and asserts the
summary is gone or rewritten with the surviving citations only; no orphaned
summary row survives.

## T2.2-7 — Panel, docs, validation report

**Deliverable:** per-scope provider switches with the payload preview, "which
model produced this" on each summary, "turn off and purge", `docs/semantic.md`,
`docs/validation-phase2-2.md`, roadmap update.

**Acceptance:** screenshot reviewed; the purge action leaves no summary of that
kind behind.

## Out of scope for 2.2

Any remote provider actually running (the seam and the guard exist; enabling it
needs its own decision), embeddings/vector search, and cross-device sync.
