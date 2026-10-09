# ADR 0015 — Ask Your History and one-time AI note reads

Status: Review candidate (M3)  
Date: 2026-10-10

## Problem

M1 Work Memory locates projects; M2 stores notes users explicitly confirm.
Neither feature answered everyday questions like "which files did I edit last
week?" nor defined how long-term notes could reach an AI model without turning
them into ambient context.

## Decision: deterministic metadata retrieval

`computer_history_ask` and local Host `POST /api/computer-history/ask`
interpret bounded Chinese/English questions over retained Episodes. The
parser supports today, yesterday, this/last week, a YYYY-MM-DD day, and a
bounded recent-N-days window. It categorises a question into project, file,
application, save, verification, or general activity. This is **not a general
LLM**; novel paraphrases can be missed. Results are locally ranked and
deduplicated by project/resource identity.

Each result carries exact source Episode ID, timestamp, evidence tier, and
optional resource URI and project locator. Titles, labels and historical
verification metadata are untrusted data. A recorded successful test is not
proof that a test currently passes.

Reads obey the source Episode TTL at read time. A recent-only scan is capped
at 1,000 Episodes and returns `scanTruncated`; a non-match means **not found
within the retained bounded evidence**, never that the work did not happen.
There are no new collectors, no page or file body reads, no embedding store,
no background indexing, and no model/network calls in the query path.

## Decision: protect M2 notes separately

Natural language `ask` **never** searches M2 user-confirmed notes, regardless
of query or Agent context. The tool has no implicit note-enumeration
capability. Instead, a user may choose ONE visible saved note, read its text,
tick a distinct AI-sharing acknowledgement, and explicitly generate a
one-time 192-bit access code in the local UI.

The UI warns that the note can enter the configured DSH model's context,
including a remote model. The user then intentionally copies the code into
the DSH conversation and invokes `computer_history_note_read`. The code is
kept only as an in-process SHA-256 digest, expires after ten minutes, is
single-use, can be revoked, and is replaced when a second code for the same
note is generated. A note edit (even at identical timestamps) or deletion
invalidates it because grants are bound to a SHA-256 digest of the exact
note text. A Host restart discards the in-memory grants.

The code is a bearer capability: anyone with it could consume that one note
during the validity window. Users should share it only in their intended
DSH session. This is intentionally not an automatic project-wide permission.

## Verification

Automated tests cover Chinese/English question interpretation, dates,
historical save and verification semantics, cross-project distinctions,
deterministic ranking, deleted/compacted evidence, malformed input, no-note
exfiltration through `ask`, explicit note consent, one-use/revoked/expired
codes and invalidation after note edits or deletes.

Manual real-user acceptance remains deferred by owner request. Do not claim
that an installed version exposes this UI until a release has shipped.

## Out of scope

Generative free-form answers, semantic embeddings, cross-session automatic
memory injection, capturing file bodies, and reopening arbitrary applications
as a consequence of history search. These need their own security review.
