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

## Architectural invariants

1. Collector never reads work content by default.
2. Observation is evidence, not truth.
3. Episode is a bounded continuous work segment, not a project bucket.
4. History locates authoritative sources; it does not replace them.
5. Ambiguous evidence produces abstention rather than a guess.

Implementation details are frozen by the Phase 0.75 Architecture Freeze and Phase 1 Implementation Spec. Contract changes require an ADR.
