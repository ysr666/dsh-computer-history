# ADR 0019 — M7 Suggested Automations: historical cadence, not scheduling consent

Status: Review candidate (M7)
Date: 2026-10-10

## Purpose

M6 identifies repetition, but repetition alone is not a reliable request for
recurring automation. M7 detects a narrower signal: repeated *trusted test or
build verification* activity with an approximate calendar cadence.

This is **a reminder suggestion**, not a schedule, task registration, action
plan, permission grant, or confirmation that tests should run unattended.

## Evidence threshold and interpretation

A read-only Host projection inspects at most 1,000 retained Episodes in one
exact, already trusted Work Thread (M1 opaque project ID resolved to an exact
stored threadKey). Neither window-title matching nor M4 temporal associations
are permitted as project membership.

Only `Episode.verifications` kinds `test` and `build` are considered.
One latest Episode is selected per **UTC calendar date** and verification kind:
neither multiple rows in one Episode nor `observationCount` establish extra
occurrences. No command string, source-file contents, window titles, model
summaries or user notes are inspected.

Cadence rules:
- **Daily hint:** latest four distinct observation dates must be four
  consecutive UTC calendar days; last date at most 10 calendar days old.
- **Weekly hint:** latest three distinct observation dates must have adjacent
  gaps of 6–8 UTC calendar days; last date at most 16 days old.
- Other or stale histories yield **no reliable cadence**. A verification
  outcome does not prove a current successful build/test or that any recurring
  review is desirable.
- No model inference, clock-hour inference, cron expression, timezone
  deduction, or next-run timestamp. UTC dates are evidence labels, **not
  a proposed execution timezone**.

At most two candidates per project, with opaque stable IDs, kind, last
observation timestamp, date evidence, Episode IDs, missing user decisions
and an explicit `review-reminder-only` permission bound.

## User experience and approval boundary

The bilingual Work Memory project inspector shows "Suggested automations":
historical cadence indicators and an evidence expander. Expanding also shows
a **read-only, user-copyable review draft** that explicitly asks the user to
select the intended goal, actual recurrence frequency, local time, timezone,
notification destination, stop conditions and permissions.

The draft is never installed. This version has no scheduling endpoint,
no create/enable button, no background checking, and **no scheduler tool**.
An actual automation can only be created in a separately scoped future step
after explicit user action and a verified supported scheduler API.

The local GET `/api/computer-history/memory/automation-candidates?id=pm_...`
is no-store, validates the exact memory ID, and returns 404 if no retained
trusted project exists. It does not provide a path to create or modify tasks.

## Guarantees

- No new collectors, recurring pollers, migrations, embeddings, model calls
  or remote disclosure.
- No reading M2 saved notes; no file contents; no DSH Agent tools to run
  commands or create tasks.
- Recompute on each read from retained Episodes, so Forget/expiry drops
  supporting historical evidence.
- Do not alter Continue, Resume, target ranking, M3 Ask, M4 attribution, M5
  context, M6 Skill proposals, policies or default retention.
- A false-negative result does **not** mean no useful automation exists. A
  positive historical cadence does **not** establish that it is safe/useful
  to schedule.

## Testing and rollout

Unit: daily/weekly thresholds, insufficient dates, irregular or stale
cadence, false duplication, cross-project boundaries, state invalidation,
future Episodes, no verification, no invented clock time, deterministic
output and bounded scanning.

Host/API and SQLite: exact project scope, no-store/400/404, deletion
invalidates results, no user-confirmed note leaks, no job registration.

Run full build/typecheck/test/verify and CI. No manual installed-product
acceptance or version publishing is implied by merge.
