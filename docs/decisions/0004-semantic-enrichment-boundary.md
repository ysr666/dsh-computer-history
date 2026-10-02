# ADR 0004: Semantic enrichment boundary

Status: Accepted
Date: 2026-10-02
Accepted by: project owner (explicit approval of the local-on / remote-opt-in policy)

## Context

Phase 1 derives Episodes deterministically; the summary text is a fixed
template ("Recent computer activity / Observed resources / Applications").
That is enough for provenance, not enough to answer "what was I doing".

A model-written summary is attractive for resume, but it changes the
disclosure surface. Episode inputs — window titles, resource paths, URLs,
application names — are often far more revealing than the fact that activity
happened. Sending them to a model is a second, independent disclosure from
capturing them locally, and `docs/roadmap.md` deliberately keeps always-on
background model processing outside Phase 1.

Deletion also becomes harder. Phase 1 promises that deleted evidence cannot
survive in derived summaries (deletion rebuilds or removes derived Episodes).
A provider-side copy would break that promise unless retention is contractual.

## Decision

1. Deterministic summaries stay on by default. They are computed locally from
   observations that are already stored, so they add no disclosure.
2. Semantic summaries default to **off**, and are enabled per scope
   (workspace / application), never globally.
3. A semantic summary may be produced by a model that runs on the same machine
   (no network egress). When such a local provider is configured, the default
   for that scope becomes **on**, because nothing leaves the device.
4. A remote model is allowed only when **all** of the following hold:
   - the opt-in is recorded per scope in policy state, never as a default;
   - the opt-in screen shows the exact payload preview ("this is what will be
     sent") for the current scope;
   - the request payload is minimised first: application id, resource kind,
     file extension, observation counts, timing buckets, and the workspace
     root basename — never full paths, window titles, or URLs with query
     strings;
   - the derived summary is stored locally with citations to observation ids;
   - the deletion contract holds: deleting evidence deletes the summary, and
     the provider retains nothing (zero-retention terms or a local proxy that
     strips and re-issues the request).
5. Every summary carries provenance: `summaryKind`
   (`deterministic` | `local` | `remote`) plus the observation ids it was
   derived from. A summary without citations is invalid.
6. A summary may not state anything the observations do not support; the
   existing "untrusted observation" framing on agent-facing payloads stays.

## Consequences

- P2's semantic work is only worth doing once a local model path exists;
  otherwise it is an opt-in convenience for users who accept the disclosure.
- The client panel must show, per scope, which model produced summaries, and
  offer "turn off and purge" in one action.
- `pnpm verify` gains a guard proving no remote-summary code path can run
  without a recorded opt-in for that scope.
- Adoption is solved by making the local path good, not by defaulting a
  remote path on.
