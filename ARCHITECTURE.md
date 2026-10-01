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

Ambient capture has one owner per Computer History data directory. Multiple DSH Hosts may open the shared SQLite history for read/search/delete, but only the Host holding the capture ownership lock may run the native collector. Policy mutation is serialized by the same ownership lock so an active collector cannot continue with a stale policy.

## Data lifecycle

Raw observations are short-lived evidence with a 24-hour TTL measured from the observation timestamp. Work Episodes are independent derived product objects with a 30-day TTL measured from Episode activity time. Raw TTL expiry is evidence compaction, not a user deletion request, so an Episode may outlive its raw provenance.

A user Forget/Delete request is stricter. If the affected Episode still has complete raw provenance, it is deterministically rebuilt from the remaining evidence. If raw compaction means the remaining provenance is incomplete, the affected derived Episode is deleted in full rather than reconstructed from a partial history. Out-of-order repair follows the same rule: derived-only Episodes are preserved until their own TTL and are never silently rebuilt from an incomplete raw tail.

## Architectural invariants

1. Collector never reads work content by default.
2. Observation is evidence, not truth.
3. Episode is a bounded continuous work segment, not a project bucket.
4. History locates authoritative sources; it does not replace them.
5. Ambiguous evidence produces abstention rather than a guess.
6. History retention never manufactures provenance: incomplete raw evidence is not treated as a complete reconstruction source.
7. Capture ownership, native helper lifetime, and policy ownership are process-global concerns; Agent tools and ResumeHint remain Agent-scoped composition.

Implementation details are frozen by the Phase 0.75 Architecture Freeze and Phase 1 Implementation Spec. Contract changes require an ADR.
