# AI-first Work History retrieval (v1.1 candidate)

This is a **candidate implementation**, not a published release or proof of real-model acceptance.

## Which component understands language?

**DSH's existing LLM Agent** handles user intent, time interpretation, follow-up questions, and synthesis. DCH supplies `computer_history_query`, a deterministic **structured evidence query**, and returns metadata with source Episode IDs. There is no new model call inside DCH, no embeddings, no file/page text collection, and no background data upload.

The Timeline panel offers two distinct choices:

- **Ask DSH AI**: explicitly open a normal editable DSH composer prefilled with the user's question and a reminder to use Computer History tools. This does **not** automatically send anything and does not bind a Continue Episode.
- **Quick local search**: retain the existing bounded, deterministic `computer_history_ask` logic as a fallback for simple expressions, clearly distinguished from AI understanding.

## Agent workflow

1. Decide whether the user is asking about projects, a resource, an app, saved changes, verification, or several of these.
2. Call `computer_history_query` with **typed facets**. Avoid generic natural-language words in the optional `text` field. For example:
   - "昨天看了哪些网页？" → `resource_kind=url`, plus `since_date` and `until_date` computed by the model from the current Host-local calendar
   - "上周 TripMap 保存并测试了什么？" → two calls: `event_kind=save` and `event_kind=test` over the same time range and workspace; **do not claim that the test validated any particular saved file unless evidence proves it**
   - CAD or document work → use the observed `bundle_id`, `workspace_id`, `resource_kind` or literal resource metadata; do not hard-code a list of application names
3. Follow `hasMore` and the returned `nextCursor` for additional pages when needed, without scanning all Episodes into model context.
4. Treat Episodes as **historical pointers**, not authority about current work. Retrieve `computer_history_episode` when necessary, reopen the authoritative file/repository/URL with the normally authorized DSH tools, and verify the current state.
5. Use the already verified Continue path only when the user explicitly wants to continue. Do **not** automatically change Resume/Episode ranking or Work State priority.

## Data and privacy boundaries

- Include-only recording, disabled by default, secure-surface restrictions, retention, and deletion remain unchanged.
- Typed resource kinds: `file | directory | url | document | workspace`.
- Historical event filters: save | test | build. Episode-retained event aggregates are derived from trusted raw events, not model inference, and removed when the Episode expires or is explicitly forgotten. Legacy observations that expired before schema v16 cannot be recreated, so an empty result is not proof the activity never occurred.
- Matching resource and event facets means they occur **within the selected Episode**, not necessarily on the same file or in a causal sequence.
- Search uses retained local SQLite metadata only and never reads user-confirmed M2 notes. The one-time explicit note read remains separate.
- The `text` filter is a literal substring across metadata; it is not a semantic embedding search.
- `since_date` and `until_date` are local dates (`YYYY-MM-DD`, start-inclusive/end-exclusive), converted deterministically in the Host's local timezone. Millisecond parameters are also supported.
- Query responses are bounded to 20 Episodes and use stable Episode ID + end-time keyset pagination. No remote provider is invoked by the Host for this query.

## Evidence / what remains

A focused test suite covers URL retrieval, save/test separation, older-range filtering, pagination, expiration, Agent tool argument forwarding, date conversion and the DSH composer handoff. Static typecheck, local validation and privacy gates should be repeated against the exact candidate artifact. **A real installed DSH model choosing the right tool is still an unverified release gate**, as is user-value comparison against normal file/Git/session searches.

## Main files

`src/agent/tools.ts`, `src/shared/api.ts`, `src/host/store/episode-store.ts`, `src/host/service/local-backend.ts`, `src/host/service/computer-history-service.ts`, `src/client/ask-history-view.ts`, `src/client/continuation-reference.ts`, `src/client/panel.ts`, `src/client/index.ts`.


## Second-pass integration validation (2026-10-10)

The following checks were run against the isolated GitHub-main source archive with the candidate changes, NOT against a live-installed user plugin.

- A real DSH Agent Loop was exercised with a **controlled fixture model** that emitted an actual computer_history_query tool call. DSH executed the registered tool, the result contained an exact source Episode and URL, and the second model request received that tool output. This establishes integration wiring, **not** that a real autonomous LLM will select the right tool.
- Local Ask results now expose **Continue this work**, using the exact episodeId selected in the result. The code fetches the current Episode and reuses continueEpisodeInDsh. It never re-ranks candidate Episodes or changes the work-state target scoring.
- New Continue bindings now reject Episode IDs already expired/invalidated at bind time, before opening an unusable continuation. Already-bound sessions retain the existing read-time TTL validation behavior.
- Ask AI remains an editable DSH draft; there is no automatic send or additional background model call. The UI explicitly discloses that work metadata may be forwarded to the model configured in DSH, including remote providers. The local quick search does not do so.
- Synthetic integration tests include non-browser arbitrary CAD application bundle IDs, old date ranges, stable pagination, expired Episodes and intentionally expired raw save-event evidence.

### Third-pass implementation: Episode-retained activity facts

Schema migration 16 introduces two narrowly scoped, Episode-owned tables:
episode_saved_resources and episode_verification_results. These contain only
resource ID, save counts and time bounds, or test/build event kind, result,
counts and time bounds. Both are joined to existing resources/Episodes and
cascade away when the owning Episode or resource is deleted.

- On a new Episode the facts are computed from trusted raw observations within
  the same transaction as the Episode provenance update.
- The proven append path increments counts ONLY for newly linked observations,
  including duplicate retries, and the full-replace path clears and rebuilds
  aggregates atomically.
- A v15 upgrade backfills only linked surviving raw events. Already compacted
  historical rows receive no invented facts.
- A normal raw TTL sweep preserves the aggregate only until the Episode TTL.
  Explicit app/time-range/episode/all Forget continues to use the conservative
  Episode delete-or-rebuild algorithm. The cascades remove retained event facts
  when an Episode is removed.
- Time filters check overlap between aggregate first/last event bounds and
  the requested interval; this is an evidence lead, not a proof an event
  occurred on every intermediate date. The model must verify sources before
  asserting precise chronology.
- Neither migration nor event query changes include-only capture, screenshot
  restrictions, protected resource filtering, user memory note permissions or
  remote opt-in boundaries.
- The audit export includes the new compacted tables for user inspection.
  Import independently recomputes event aggregates from linked raw observations
  present in the imported document. Serialized aggregate counts are never
  trusted on their own, even when supplied in the same backup.
  A backup containing only already-compacted save/test details still cannot
  fully restore these events; this is a documented portability limitation.
  Imported raw observations originate from user-supplied JSON and are not
  cryptographically authenticated by the Host, so the reconstruction is
  a consistency check rather than proof of an untampered recording.

Migration and deletion behavior require real-installed validation prior to
release; do not ship the schema change without reviewing it against the actual
current production migration history.

### Final outstanding validation

Run a real installed DSH client against a live model under its configured consent/remote processing settings, and score independent scenarios including CAD, documents, browser, multiple workspaces and source expiry. Integration fixture success must not be reported as real-model tool selection accuracy.

## Release gate: real-model tool-choice validation

The isolated fixture Agent Loop proves that DSH can execute the candidate
History tools, but does not prove a real LLM will autonomously choose them.
Real-model tests MUST preflight these conditions before sending any prompt:

- Use a DSH 0.2.0-rc.2-compatible test runner and the actual candidate
  History registration code; a pure Headless plugin may lack required services.
- The test agent must expose ONLY the Computer History tools. File access,
  shell execution, networking tools and unrelated user-context tools must
  be completely unavailable, not merely forbidden by prompt wording.
- Only a synthetic store and synthetic source references may be mounted.
  Verify the absence of any path to real user history, projects or sessions.
- Keep a bounded tool-call budget and terminate on unexpected tool selection.
- Separate credentials/test state from production; keep recorded artifacts
  free of secrets and personal data.
- Score at least web/CAD/document/coding, cross-app and multi-intent queries.
  Verify source grounding and a safe transition to Continue.

If any preflight fails, do not send the test request. No real-model
tool-selection acceptance is claimed by this candidate.


## Fifth pass: fail-closed tool registry and real LLM tool-choice evaluation

Development/runtime isolation: The production Agent still registers its
existing full toolset. registerHistoryEvidenceQueryTool(ctx) exposes the
identical computer_history_query definition for an isolated test Agent.
Tests create a bare DSH Agent Loop with no web, shell, file, connector, or
personal-history providers and a synthetic in-memory service. The test
preflights ctx.tools.schemas(agent) before sending any message; if ANY
tool beyond computer_history_query is visible, the test refuses to run.
A scoped monotonic execution guard also rejects non-History dispatches.

Verified negative cases in the real DSH Agent Loop (controlled fixture model):
- A forged bash tool call cannot execute.
- An accidentally registered bash tool fails the preflight before the
  model is called.
- A tool query budget is enforced even when the model makes repeated calls.
- Multiple legitimate query calls can be combined with exact synthetic
  Episode/source evidence. No production work-history store is opened.

Actual LLM tool-choice probes: Using the exact query definition exported
from candidate source, a real DeepSeek chat model was called through its
official API with ONLY synthetic prompts and a single declared History
function. 11 tool-choice requests were observed, comprising 19 selected
function calls; all selected computer_history_query. Five of those requests
used natural Chinese/English questions without explicitly directing the
model to call a tool. This validates tool selection only,
NOT DSH-installed end-to-end accuracy or continuation.

Parameter bugs found through genuine model outputs and corrected through
the shared tool description:
- The model initially treated Chinese 上周 as a rolling seven-day window
  (2026-10-03 to 2026-10-10). A repeat test after clarification selected
  the previous calendar week (2026-09-28 to 2026-10-05).
- It initially requested limit=50, exceeding the actual max of 20. After
  explicitly documenting the bound, the repeat test requested limit=20.
- File-type descriptions such as CAD can be over-applied as literal text
  filters, which may cause false negatives. The tool now recommends starting
  with structured resource/event facets and broadening before exact terms.

Important limits: No actual local model or DSH installed plugin was
used for the direct API queries. There was no access to a user's real history
database and no system-tool access in those API prompts. The Agent Loop
integration/denial tests use deterministic fixture models; model-side
synthetic tests use the real model but do not invoke the DSH Loop. Therefore
the two results cannot be conflated into full live Host acceptance. Before
release, run the complete installed stack in an isolated test Host with a
monotonic allowlist and fully synthetic store. Record parameter validity,
tool selection, source-grounded answers, query fallbacks, and Continue behavior.


## Sixth pass: complete synthetic Find -> Answer -> Continue acceptance

The project now includes a fully automated integration test:
tests/integration/find-answer-continue-synthetic.spec.ts.

It uses REAL DSH Context/Sessions/Agents/AgentLoop, the SAME production
History query tool implementation, a REAL temporary SQLite EpisodeStore and
LocalComputerHistoryBackend, and the production continueFromHistoryHit
entrypoint into an actual bindContinuationSession call.

Only the model's tool-choice and answer synthesis are a deterministic test
fixture. Its answer is derived dynamically from the actual tool-result
JSON returned by the SQLite query; a hardcoded success message cannot pass.

The synthetic test suite verifies:
- CAD save discovery and exact source Episode citation, followed by binding
  a Continue session to that exact Episode ID;
- Same-name CAD files in distinct workspaces cannot cross-contaminate a
  workspace-scoped query;
- A missing workspace produces no invented nearest match and no continuation;
- Save/test as separate tool calls and evidence combination;
- A no-result build query produces no fabricated result or Continue;
- A retained Episode that expires between answer and click is refused.

The only model-accessible tool is computer_history_query, and no live DSH
history store, user home files, arbitrary system commands, or remote provider
is used. Existing Continue selection/ranking rules remain unchanged.

tests/manual/history-real-synthetic.spec.ts is an optional, default SKIPPED
integration draft. It has NOT been executed successfully against a real
model. Remote model execution was stopped after the execution platform
blocked credential access. Do not bypass that control. Live installed-client
UI and human-in-the-loop Continue acceptance remain open release gates.


## Eighth pass: AI answer → verified Episode → explicit Continue

The history page now exposes a two-step bridge between DSH AI answers and
the existing trustworthy Continue path. The user copies the exact Episode ID
from the AI answer, pastes it into the history view, and chooses Inspect source.
Only after the Host returns a retained Episode whose ID exactly matches the
input does the page show its recorded workspace/summary and an explicit
Continue this Episode button. Clicking Continue reads that same Episode again
and passes it into the original DSH Continue session preparation and binding.

The AI question template requests exact source Episode IDs rather than
fabricating them, but never auto-sends, binds or continues. Inspect is local
to the DCH Host, not an extra AI/provider request. History and current file
state must not be conflated.

Regression tests cover:
- Visibility of the bridge only when Ask AI and Continue are both wired;
- Exact ID inspection, source preview, explicit Continue and fresh re-read;
- Forged or mismatched lookup IDs;
- Expiry/deletion between inspection and click;
- Clearing source on input change and ignoring stale asynchronous lookups.

This is a safe manual bridge, NOT an automatic clickable Episode link inside
the DSH LLM message renderer. A genuine installed desktop UX/visual acceptance
test remains a release requirement and was NOT completed by these hook/event
tests.


## Ninth pass: desktop-oriented source preview and compact slots

The explicit human-confirmed Episode bridge is unchanged. The preview now
shows recorded workspace title, Episode end time in the current locale,
up to three associated historical resource names, a compact source ID, and
an explicit warning that historical evidence cannot establish current file
existence or task completion. The Continue button shows its pending state.
No external link is followed automatically and no file contents are read.

The History view's 150px minimum input width caused a potential horizontal
overflow in very narrow DSH slots. The input now has min-width: 0 and a
container-safe max-width; controls wrap on small windows. CSS preserves
word-breaking for unusually long Episode IDs and file resource names.

In addition to component event tests, a **synthetic standalone Chromium
layout fixture**, not an installed DSH screenshot, exercised the actual
project CSS at container widths 131, 320, 420 and 680px. Chromium returned
zero overflowing descendants at all four widths. The 131px visual remains
uncomfortably narrow for a full interaction surface: this is not evidence
of a good full desktop UX at that width. The reference fixture is held only
under /tmp/dch-v11-ai-first/ui-layout-qa and is not packaged or released.
Live installed-DSH visual and mouse/keyboard acceptance are still pending.


## Tenth pass: isolated DSH Web Host runtime acceptance

An independent DSH 0.2.0-rc.2 Web Host was launched using separate HOME,
DSH_HOME, plugin dependencies, browser profile and disabled DCH collection.
Config composition verified that candidate Computer History was present with
enabled: false, no real DSH history path, and no production credentials.

The real browser (Chrome DevTools Protocol, not simulated React hooks)
loaded native DSH UI, opened the Computer History sidebar, expanded the
history question panel, inspected an intentionally nonexistent Episode ID,
and displayed an error without offering a Continue action. A local metadata
search returned no retained evidence and did not start a model request.
The native Settings modal mounted the DCH Settings view, showing recording
unavailable, zero allowed applications and a 30-day retention policy.

At Web viewport widths of 420, 600 and 1180px, page and History panel
horizontal overflow checks passed; at 420px the DSH Settings layout
allocates only 131px to the plugin Settings column. All visible DCH Settings
elements stayed within the viewport, though the resulting narrow copy is
far from ideal. This is a Host layout constraint, not evidence that a
native Electron Desktop plugin has been accepted.

The test did NOT enable screen/capture permissions, bind to real history,
send AI messages, import/export or delete user data. Isolated Host and
Chrome processes were stopped; ephemeral browser cookies and authentication
URL were removed after the test.

For the exact constraints, tested cases and remaining gates, see
docs/qa-isolated-web-host-2026-10-10.md. Electron-installed UX and genuine
end-to-end real-model Continue remain OPEN release gates.


## Fourteenth pass: WAL-consistent v15 → v16 rehearsal

Automated `tests/integration/synthetic-upgrade-rehearsal.spec.ts` creates only
synthetic Episode/observation metadata. It verifies SQLite online backup
while the source database is in WAL mode, migration on the restored copy,
source-file integrity after backup, and recovery after deliberately failing a
checksum validation by **restoring** (not downgrading) the earlier snapshot.
It confirms historical save/test evidence and never invents an expired raw
save. Details and caveats in `docs/upgrade-v1.1-preflight.md`. No live DSH
user profile, real private database, or external model was accessed.


## Fifteenth pass: transactional migration failures and correlated save-resource evidence

Synthetic v15 -> v16 migration testing now forces an error BETWEEN the
migration's two CREATE TABLE statements. This exercises transactional rollback
rather than only checksum verification. The database stays at v15, its original
observations remain, no partially-created v16 table survives, and a retry
works after repairing the synthetic conflict.

A red/green regression identified and fixed a REAL incorrect result in
EpisodeStore.queryEvidence: independent Episode-wide predicates for
resourceKind=file and eventKind=save let "viewed a file, saved a URL"
masquerade as "saved a file." The query now joins saved.resource_id to
resources.kind when both filters are specified, and applies time boundaries
to that saved resource's own first/last change bounds. This correlation
continues working after raw observations expire using the retained table.

Scope limit: eventKind=test|build is recorded per Episode/event kind rather
than per resource, so test/build plus a file filter still means two activities
co-occurred inside an Episode. The tool and Host caveats prohibit claiming
that a particular file was tested or built. First/last bounds also do not
prove an event occurred on every intervening date. No new schema migration,
automatic continuation, or permission change was added.

Tests: tests/integration/evidence-query.spec.ts and
tests/integration/synthetic-upgrade-rehearsal.spec.ts. All fixtures are
synthetic and do not access actual DSH histories or credentials.


## Sixteenth pass: resource-name / save provenance correlation

A red/green fixture found that an Episode which VIEWED unsaved_model.step but
SAVED saved_assembly.step was a false positive for the question "did we save
unsaved_model.step?" if the model used the original broad text filter.
This was a real facet-granularity limitation even after the previous
resourceKind=file plus eventKind=save correlation fix.

The new optional resource_text / resourceText filter is a literal
resource-URI or resource-label substring. Unlike broad text (which also
matches Episode summary and workspace), it stays in one correlated EXISTS
subquery with optional resourceKind=file|... and eventKind=save, joining
the saved fact back to that exact resource row. File kinds, resource names,
save events and date bounds cannot be satisfied by unrelated resource rows
inside one Episode. Matching remains case-insensitive with LIKE wildcard
escaping. After raw TTL it queries retained resource / saved-resource facts;
it never guesses lost pre-migration saves.

The Agent tool description instructs the model to use resource_text for
specific filenames rather than broad text, but neither param automatically
reads file contents or grants access. The older text API remains intact for
summary/workspace searching, so this is additive and backward-compatible.
Tests exercise the actual Host SQLite lookup, source exactness after raw
expiry, DSH tool parameter marshalling, and the strictly synthetic
Find -> Answer -> Continue scenario.

Important limitation: event_kind=test/build is still an Episode-level
verification, NOT per-file proof. resource_text plus test/build therefore
cannot establish that the named file itself was tested/built; tool caveats
remain explicit. Live-model and native Electron interaction release gates
remain open.


## Seventeenth pass: release package negative test and future-proof version gate

A deliberately no-lifecycle npm pack --ignore-scripts candidate tarball
was generated in /tmp and checked. It contained the JS Host/client exports,
types, locales and icon but none of the three native collectors, browser
extension or editor VSIX. The existing verify-release.mjs correctly rejected
the archive. This is expected because prepack was not run; it is not
evidence of a broken official release assembly.

The stale Release workflow VERSION = 1.0.1 check was independently fixed in
Draft PR #167 (v1.1 release preparation). This AI-first feature PR deliberately
excludes the overlapping release workflow change and its standalone test;
#167 must be reconciled before any release is authorized.

No collector, extension, production package, npm registry, PR or release was
created or published. The manifest still says 1.0.1 because v1.1 has not
been cut. Native Electron interaction, real-model synthetic E2E, signed
three-platform assembled tarball, release notes/version identity and an
authorized migration restore remain release blockers. See
docs/ai-first-release-gates-2026-10-10.md for complete evidence and limits.
