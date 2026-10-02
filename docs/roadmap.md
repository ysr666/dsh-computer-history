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
- Password managers, Keychain Access, secure fields, and protected file patterns are fail-closed. A browser *window* seen through Accessibility still contributes nothing: URL resources are accepted only from the paired companion (ADR 0007).
- Browser metadata was deferred until a companion could enforce private/incognito boundaries. **Retired 2026-10-02**: the Chrome MV3 companion exists, and the seven-cell privacy matrix in `docs/validation-phase2-1.md` (T2.1-6) passes on real Chrome — allowed origin stores one normalised URL, denied origin, incognito window, rotated token and a disabled extension each store nothing, and a query string never reaches the store. Setup and rotation: `docs/companion.md`.
- No screenshots, audio, keystrokes, terminal contents, source-file contents, page bodies, selected text, or Accessibility value reads.
- Raw observations remain local and expire after 24 hours by default.
- Episodes remain local and expire after 30 days by default.
- Deletion rebuilds or removes derived episodes so deleted evidence cannot survive in summaries.

### Phase 1 resume boundary

Normal turns receive no Computer History payload. Agent scopes receive three query tools. Experimental automatic resume only activates for deterministic resume intent and remains off by default. A hint is bounded, marked as untrusted observation, and instructs the Agent to reopen authoritative sources before acting.

## Phase 2 — Daily-driver alpha (planned)

Draft plan: `docs/plan-phase2.md`; executable 2.0 task list:
`docs/plan-phase2-0.md`. Boundary decisions: ADR 0002 stays (metadata-only);
ADR 0004 (accepted) governs semantic summaries.

1. **2.0 Quality and trust base** — adapter coverage and resource attribution
   (JetBrains/Xcode/Notes/Obsidian/Word, Cursor Agents window, unanchored
   aggregation) + encrypted store and a written threat model.
2. ~~**2.1 Browser companion** — Chrome MV3 extension with incognito fail-closed
   and site-level allow/deny; retires the "browser deferred" clause below with
   evidence.~~ Done 2026-10-02; the clause above is retired, the matrix is in
   `docs/validation-phase2-1.md`, and the per-site controls land with the panel
   work.
3. **2.2 Semantic layer** — local-first summaries with observation citations,
   Work Threads over the existing `threadKey`, and a usable opt-in ResumeHint.
4. **2.3 UI and audit** — timeline, per-app/per-site controls, export/audit,
   redaction preview; closes the Phase 1 findings (F13, unanchored
   presentation, allow/forget ergonomics).

## Deferred

Semantic/model enrichment beyond local-first summaries, Work Thread
intelligence beyond 2.2, shell/editor companions, Windows/Linux collectors,
and always-on background *remote* model processing stay outside Phase 2.

