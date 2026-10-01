# Roadmap

## Phase 0.5 — Feasibility gates

Completed: metadata-only AX spike, deterministic episode prototype, DSH seam smoke, and resume benchmark experiments.

## Phase 0.75 — Architecture freeze

Completed: product boundary, technology stack, ownership, privacy model, and Phase 1 architecture frozen.

## Phase 1 — DSH-integrated alpha

Completed on 2026-10-01.

1. Repository/tooling gates
2. Shared TypeScript contracts
3. SQLite/migrations/stores
4. Deterministic Episode Engine
5. Deterministic Resume Engine + fresh benchmarks
6. Cordis ComputerHistoryService
7. Swift event-driven metadata collector
8. DSH managed subprocess integration
9. Live ingestion/privacy gates
10. Authenticated Host API
11. History/Privacy Client panel
12. Agent-scoped query tools
13. Experimental one-shot ResumeHint, off by default

### Phase 1 privacy boundary

- Capture is disabled by default.
- App capture is include-only.
- Password managers, Keychain Access, secure fields, protected file patterns, and browsers are fail-closed.
- Browser metadata is intentionally unavailable until a companion can enforce private/incognito boundaries.
- No screenshots, audio, keystrokes, terminal contents, source-file contents, page bodies, selected text, or Accessibility value reads.
- Raw observations remain local and expire after 24 hours by default.
- Episodes remain local and expire after 30 days by default.
- Deletion rebuilds or removes derived episodes so deleted evidence cannot survive in summaries.

### Phase 1 resume boundary

Normal turns receive no Computer History payload. Agent scopes receive three query tools. Experimental automatic resume only activates for deterministic resume intent and remains off by default. A hint is bounded, marked as untrusted observation, and instructs the Agent to reopen authoritative sources before acting.

## Deferred

Chrome companion, semantic/model enrichment, Work Thread intelligence, shell/editor companions, Windows/Linux collectors, and always-on background model processing are intentionally outside Phase 1.
