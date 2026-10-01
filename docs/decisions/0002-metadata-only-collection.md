# ADR 0002: Metadata-only collection boundary

Status: Accepted
Date: 2026-10-01

## Decision

Phase 1 observes resource/application/window identity metadata but does not read work content.

## Rationale

Phase 0.5 showed that VS Code file identity, Terminal cwd, document identity, and DSH workspace affinity can recover useful work context without reading terminal buffers, source contents, page bodies, screenshots, or keyboard input.

## Consequences

The native collector uses a positive allowlist of AX attributes. Adding any new content-bearing attribute requires an architecture/privacy review and tests. Generic browser resource capture is deferred until private-mode exclusion can be guaranteed.
