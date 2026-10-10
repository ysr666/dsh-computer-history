# ADR 0017 — Contextual Continue (M5): on-demand session-bound project context

Status: Review candidate (M5)
Date: 2026-10-10

## Problem

The existing Computer History Continue path already has two working layers:

1. A small, bounded first-turn bootstrap, attached through the existing
   `computer_history_continue` tool schema.
2. A deeper explicit `computer_history_continue` read that recovers the
   structured handoff and, where permitted by the original session reference
   mechanism, the prior DSH session's bounded task snapshot.

M1–M4 add provenanced project memory and cross-application activity hints.
There was no opt-in Continue-specific method for an Agent to see this additional
same-project context without searching unrelated projects.

## Decision

Add the **optional** zero-argument Agent tool
`computer_history_continue_context`.

The tool derives the current DSH Agent session ID from the executing Agent
context; callers cannot supply a project name, thread key, session ID, or
arbitrary Episode ID. The Host resolves that exact session's existing
ContinuationSessionStore binding. A missing binding returns
`no-session-binding` without revealing history.

The Host then checks the bound Episode **again** against current database
retention and invalidation, using `EpisodeStore.getRetained` (state must not
be invalidated; `expires_at_ms` must not have passed). This matters because a
Continuation session binding can otherwise outlive its source Episode TTL.

If the retained Episode lacks an authoritative `threadKey`, the tool returns
`no-trusted-project`. It resolves the project's opaque M1 ID exclusively from
the stored exact `threadKey`; never by fuzzy workspace titles.

The optional context is a **bounded, provenance-carrying projection**:
- At most 8 M1 facts from retained Episodes with source Episode IDs, max 240
  characters per text, 3 source IDs per fact.
- A project locator (opaque ID, title, episode count, last observed timestamp).
- At most 4 M4 cross-app hints, retaining the crucial distinction between
  `exact-resource` evidence and `nearby-unassigned` temporal suggestions,
  each with actual Episode ID and trusted anchor ID. Metadata/URI lengths are
  bounded, and scan truncation is explicit.
- Host scan: up to 1,000 retained Episodes of the exact trusted thread for
  M1; an additional up-to-250 anchored + 750 recent (deduplicated) episodes
  for M4. No background index, new collection, migrations or persistence.

## Security and product invariants

- The existing Continue selector, Work State target ordering,
  Resume/Episode resolver, and first-turn bootstrap are **unchanged**.
- No automatic M5 injection into ordinary prompts; the Agent chooses the
  extra read explicitly in the current session.
- M2 user-confirmed notes are **not accessed** at all. The separate
  one-time note code is still required for the M2 Agent read tool.
- No cross-project query, automatic Ask Your History search, model inference,
  file content read or new network egress.
- The historical facts and UI/metadata labels are **untrusted data**, never
  commands or current facts. The Agent must verify live files, repository
  and test results before acting.
- Read permissions constrain DCH's tool surface; this is not an OS sandbox
  against unrelated locally privileged tools.
- A missing/expired/forgotten bound Episode fails closed. When the bound
  Episode lacks authoritative thread identity it also fails closed.

## Test plan

- Unit: exact project identity, evidence provenance, truncation and
  size limits, temporal hints stay unattributed, source objects unchanged.
- Agent: zero-argument tool, current session ID only, no note tool read,
  no ambient context when there is no executing Agent session.
- Integration using a real SQLite store: no binding, successful binding,
  cross-session denial, M2 note exclusion, expiration while binding survives,
  Forget/delete, missing authoritative thread identity.
- Full regression: existing Continue bootstrap, handoff, selection, retention,
  app-side API, three-platform CI and packaged product gates.

## Out of scope

No background AI memory, no full-text RAG, no changes to installed plugin
release/version, and no automatic user note disclosure. Release and human
acceptance remain separate processes.
