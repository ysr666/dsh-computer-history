# Architecture

## Product model

DSH Computer History is implemented as a Work Continuity layer, not as a general activity logger.

macOS metadata collector -> NDJSON over managed stdio -> Host Activity Service -> local observation store + workspace/resource canonicalization -> Deterministic Episode Engine -> Work Continuity Service -> Agent / Client History UI.

## Phase 1 boundaries

- Native collector: Swift, macOS only.
- Host/Agent/Client: TypeScript.
- Persistent storage: local SQLite.
- Browser companion, semantic model enrichment, Windows, and Linux are deferred.
- Automatic ResumeHint stays experimental/off until the benchmark gate passes.

## Ownership

Repository ownership rules are defined in this document and docs/development.md.

Ambient capture has one owner per Computer History data directory. Multiple DSH Hosts may open the shared SQLite history for read/search/delete, but only the Host holding the capture ownership lock may run the native collector. Policy mutation is serialized by that ownership domain: the owner borrows a process-local policy lease, and capture ownership cannot be released to another Host until all such leases drain. A non-owner must acquire the cross-process lock for the full mutation and propagation interval.

## Collector control protocol

The native protocol is hello-first and fail-closed. Pause and resume complete only after the corresponding native state acknowledgement. Policy configuration carries a revision and completes only after the native helper emits a matching `configured` acknowledgement; a running policy transition is `pause ack -> configure -> matching configured ack -> resume ack`. Missing, unexpected, mismatched, or timed-out acknowledgements stop the helper rather than guessing that the transition succeeded.

The collector reconciles foreground application, Accessibility trust, and observer attachment every five seconds. This is reconciliation, not periodic activity sampling: unchanged metadata is suppressed by a semantic fingerprint. Pause detaches AX observers before acknowledging `paused`; sleep also detaches observers and wake triggers reconciliation. A user-requested paused state survives recoverable helper restarts.

Durable Episode boundaries remain derived from persisted evidence. In particular, Phase 1 does not synthesize a non-replayable `sleep` Episode boundary from transient native state; adding such a boundary requires a persisted protocol/schema event and an ADR.

## Data lifecycle

Raw observations are short-lived evidence with a 24-hour TTL measured from the observation timestamp. Work Episodes are independent derived product objects with a 30-day TTL measured from Episode activity time. Raw TTL expiry is evidence compaction, not a user deletion request, so an Episode may outlive its raw provenance.

A user Forget/Delete request is stricter. If the affected Episode still has complete raw provenance, it is deterministically rebuilt from the remaining evidence. If raw compaction means the remaining provenance is incomplete, the affected derived Episode is deleted in full rather than reconstructed from a partial history. Out-of-order repair follows the same rule: derived-only Episodes are preserved until their own TTL and are never silently rebuilt from an incomplete raw tail.

Completeness is proven, not assumed. An Episode counts as completely provenanced only when it links at least one raw observation and its link count equals the resource/surface aggregate counts. Episode aggregates are derived from the links actually written rather than supplied by the caller, so those two counters cannot drift apart; an Episode that has lost the provenance it was derived from is rewritten in full instead of being extended.

## Architectural invariants

1. Collector never reads work content by default.
2. Observation is evidence, not truth.
3. Episode is a bounded continuous work segment, not a project bucket.
4. History locates authoritative sources; it does not replace them.
5. Ambiguous evidence produces abstention rather than a guess.
6. History retention never manufactures provenance: incomplete raw evidence is not treated as a complete reconstruction source.
7. Capture ownership, native helper lifetime, and policy ownership are process-global concerns; Agent tools and ResumeHint remain Agent-scoped composition.

Implementation details are frozen by the Phase 0.75 Architecture Freeze and Phase 1 Implementation Spec. Contract changes require an ADR.
