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
3. ~~**2.2 Semantic layer** — local-first summaries with observation citations,
   Work Threads over the existing `threadKey`, and a usable opt-in ResumeHint.~~
   Done 2026-10-02: every summary carries `summaryKind` and citations
   (`deterministic` on by default), threads and hints are computed views over
   that evidence, deletion cascades to the citations, and a model may only run
   locally — remote needs a recorded per-scope opt-in plus a payload preview,
   enforced by `verify:semantic-boundary`. See `docs/semantic.md` and
   `docs/validation-phase2-2.md`.
4. ~~**2.3 UI and audit**~~ — done (2026-10-02): timeline and per-episode
   provenance, per-app/per-site/per-retention controls, export and re-import,
   redaction preview. Closes the Phase 1 findings: F13 by ADR 0008 (a file name
   the Host cannot place is not stored), the "Unanchored activity" label by
   naming the applications the episode did see, and the allow/forget flow by
   one-click controls inside an episode. See `docs/audit.md` and
   `docs/validation-phase2-3.md`.

## Deferred

Semantic/model enrichment beyond local-first summaries, Work Thread
intelligence beyond 2.2, shell/editor companions, Windows/Linux collectors,
and always-on background *remote* model processing stay outside Phase 2.

## Phase 2.4 — Integrity and guard hardening

Completed on 2026-10-02, plan `docs/plan-phase2-4.md`, evidence
`docs/validation-phase2-4.md`.

1. **A guard that could fail** - the route-set test compared paths against a fake
   registry that silently overwrote a duplicate, which is why the duplicate
   `/retention` registration in 2.3 passed it and only failed at runtime. The fake
   now enforces the real rule, with the real message, and was calibrated red then
   green.
2. **A summary could lose its evidence with nothing recording it** - the citation
   rewrite ran *after* `commit()`, so a failure there left links committed and
   citations deleted with no rollback and no deletion record. Reproduced by a test,
   root-fixed by moving the rewrite inside the transaction.
3. **Two maintenance cycles against a reachable episode** - nothing moved, which
   is what the fix and the isolation test predict.

## Phase 2.5 — Editor companion

Plan `docs/plan-phase2-5.md`, evidence `docs/validation-phase2-5.md`, setup and
traps `docs/editor-companion.md`, boundary ADR 0009.

The companion pattern from ADR 0007 extends to the editor without a new trusted
concept: one loopback intake with two disjoint payload shapes, contents
unrepresentable by type and refused by validation, and per-workspace consent
reusing the existing resource dimension. An editor observation carries the
workspace root the editor vouched for, recorded with its own `workspace_source`
(`companion`) rather than misreported as an inference - which fixes the Phase 2.3
"unanchored" finding at its root: measured live, the same editor at the same
moment produces `ws=none` through Accessibility and `ws=companion` with the real
root through the companion.

## Phase 2.6 — Remote model processing

Plan `docs/plan-phase2-6.md`, boundary ADR 0010, operation
`docs/remote-models.md`, evidence `docs/validation-phase2-6.md`.

The semantic layer could always run locally; this phase made the remote path real
and bounded. A remote summary is only produced for a scope with a recorded opt-in
(the check is the provider's first statement, and a scope without one performs no
network call at all), the request body is the minimised shape and nothing else,
the preview and the send share one body builder so they cannot drift, the response
must cite observations from the set it was given, there is no retry, and every
send is recorded - host, model, time, digest - so the audit can answer what left.
Revoking forgets the local record and the panel states plainly that the remote
side cannot be recalled.

**The claim "nothing leaves this machine" is now conditional** on the scope, and
every document that made it unconditionally has been updated.

## Phase 2.8 — One editor companion for every editor

Plan `docs/plan-phase2-8.md`, boundary ADR 0011, operating notes
`docs/editor-companion.md`, evidence `docs/validation-phase2-8.md`.

The Host used to hardcode VS Code's identity, which meant one Host release per
editor. Now an editor payload declares `app: { bundleId, name }` and the Host treats
it as a **claim**: validated, recorded as coming from a companion rather than from
the operating system, subject to the same allow-list, and unable to unlock an
application the built-in protected list covers. One extension therefore serves any
VS Code-based editor, and another editor needs a client rather than a Host release -
the wire format is documented for exactly that.

Proven on this machine: a real VS Code window activated the extension, the extension
sent its own observation, and the stored row carries the identity it declared about
itself. Not proven: that the **installed** `.vsix` activates in a normally launched
window (it does not; the same code does from source), which is the first item of the
next phase.
