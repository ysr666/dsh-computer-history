# ADR 0014: Explicit user-confirmed Work Memory notes (M2 draft)

Status: **Draft implementation / awaiting review**
Date: 2026-10-10

## Decision

M1-derived work facts are ephemeral and follow the Episode retention window. M2
adds a separate persistence category solely for **text deliberately authored and
confirmed by the user**. No previous Episode summary, window title, file name,
terminal content, browser page body, or model inference may be copied into a
persistent note automatically.

The user must see, **before saving**: the selected project label, the exact
note text, that it persists after short-term Episodes expire until deleted, and
that explicit Forget can remove it. No unattended model prompts or background
saves. The user-facing UI requires a separate acknowledgement checkbox and Save
action; the Host endpoint independently enforces retention acknowledgement.
The DSH Agent tool set does not expose any long-term note mutation.

## Storage and source boundaries

Migration 0014 introduces `memory_projects`, `memory_user_notes`, and
`memory_note_apps`. A note stores the intentionally confirmed project label and
text plus a bounded originating Episode locator, observation interval and
application bundle identifiers. These source anchors may remain after Episode
TTL solely because the user explicitly confirms long-term storage. They are
not used to infer the task's present status or to reopen files.

A save requires a currently retained, non-invalidated Episode; the transaction
rechecks this before committing, so a concurrent Forget or expiration cannot
turn a stale selection into permanent memory. A note has
`evidenceLevel=user-confirmed`, not `observation-backed`.

## Erasure semantics

An ordinary retention sweep may remove raw Observations and Episodes but keeps
explicit notes. `DeletionService` deletes related notes within the same
transaction for the following intentional user actions:

- All history: delete all confirmed notes and orphan project shells.
- One Episode: delete notes anchored to that Episode.
- An application: delete notes whose saved source anchor includes its bundle ID.
- A time range: delete notes whose original source interval overlaps the range.

Notes do not survive a rolled-back Forget transaction. No derived content is
cached or retained by this migration.

## Export and restore

The normal audit export includes all three new tables so the user can see
everything the Host retains. Existing history-import flows **must not**
silently reactivate indefinitely-retained notes. The normal history import continues to ignore all note tables. A distinct
restore API validates project identity, provenance and application links,
rejects conflicting identities transactionally, and requires a second explicit
user confirmation after the UI has shown the backup contents.

## Implementation boundary

- No new collector events, model call, network egress, or changes to Continue.
- M2 now has user-acknowledged save/edit/delete UI, isolated restore UI and
  Host API. It is **not yet approved for release** pending review of platform
  integration, opt-in copy and any outstanding CI checks.
- Keep M2 on a separate review branch and do not claim completion from the
  migration and store tests alone.
