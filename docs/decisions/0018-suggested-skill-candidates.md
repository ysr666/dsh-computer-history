# ADR 0018 — Suggested Skills as evidence-bounded workflow candidates (M6)

Status: Review candidate (M6)
Date: 2026-10-10

## Goal

Users should discover potentially reusable patterns in their DCH activity,
without DCH pretending it captured reproducible procedures. A suggestion
does **not** constitute a Skill specification, user request, executable
recipe or installation approval.

## Candidate evidence requirements

The detector reads at most 1,000 recent retained Episodes from an **exact
trusted threadKey**, resolved through the existing M1 opaque project ID.
It neither clusters unrelated projects nor uses M4 time-neighbor suggestions
as evidence of project membership.

A candidate requires **at least three distinct Episode IDs** on **at least
two distinct UTC days**. Event `observationCount` and file
`changeCount` are never treated as multiple independent occurrences.

Currently supported, explicitly limited candidates:

- **Repeated verification**: repeated test or build events from a trusted
  editor task companion, without assuming command, tests, or target.
- **Repeated file-save + verification co-occurrence**: each source Episode
  contains both kinds. The **order, intent, and causation are unknown**.
- **Repeated edits to the exact same file**: full canonical local file URI
  appears in saved/changed resources across Episodes. Matching basenames
  or URLs, and mere file-open events, do not qualify.

Candidates provide a stable opaque digest ID, repeat counts, distinct day
count, bounded Episode references (maximum 12), explicit evidence truncation,
observed categories, a short factual interpretation, and missing information
necessary to design a real Skill. At most three cards appear per project.
The detector never reads episode.summary (which could contain instructions),
file content, command transcripts, M2 user-confirmed notes, or arbitrary
application window titles.

Not enough evidence yields a helpful empty state—not fabricated skills.

## Product boundary

The local Host endpoint `GET /memory/skill-candidates?id=pm_...` is
read-only and `no-store`, with an exact-ID check and a 404 for an unknown
retained project. The project inspector renders bilingual, evidence-backed
cards; it offers no create/install/run button, and no automatic Skill
definition or host script generation.

No Agent tool is exposed to execute candidates. Any future create/install
workflow needs a **separate** user review and explicit authorization for
actual steps, commands, destinations, permissions, failure handling and
expected output. Candidate discovery is not consent for execution.

The response includes `privacy.autoCreateOrInstall=false`,
`privacy.fileBodies=not-read`, and `privacy.userConfirmedNotes=not-read`.

## Source, privacy and architecture guarantees

- No new capture events, migrations, stored embeddings, background scanning,
  remote AI call or network egress.
- No changes to Continue, Resume/Episode matching, Work Thread assignment,
  M1–M5 history access, retention or the M2 note read permission.
- Every GET recomputes from currently retained Episodes, so Forget and TTL
  may remove candidates. At 1,000 Episodes `scanTruncated` is explicit.
- Candidate evidence remains **historical metadata**, not proof that
  source code is correct or a test currently passes.
- Manual human acceptance and release are separate from CI verification.

## Verification

Unit: repeat thresholds, distinct-day constraint, source deduplication,
cross-project isolation, same basename vs canonical URI, web URL exclusion,
co-occurrence non-ordering, bounded evidence and results, no title/summary
injection, Forget/expiry projection, and deterministic ranking.

Host and SQLite: exact project ID, no-store response, 400/404 validation,
no leakage from user-confirmed notes and Forget invalidation.

Full Node build/typecheck/test/verification, then GitHub CI before merge.
