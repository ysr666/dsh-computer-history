# AI handoff: Computer History client UI

Read this before changing `src/client/**`. This is the current architectural contract, not a suggestion list.

## What is fixed in this working tree

Treat the current tree as the architectural baseline. Do not undo these boundaries while making visual changes.

The client has been changed from two large, independently-fetching UI files into one explicit data/control path:

- `src/client/api.ts` is the only browser HTTP owner and uses typed Host request/response contracts. This fixes the former broken retention save, broken delete body, wrong companion pairing route, and redundant discarded `/retention` fetch.
- `src/client/store.ts` owns shared control state (`state`, `policy`, `retention`) and folds canonical mutation responses instead of POST-then-refetching unrelated data.
- The store is **not a module-global singleton**. `apply(ctx)` creates exactly one store instance for that plugin application and passes the same instance to Main and Settings. Keep lifecycle ownership there.
- Settings has truthful `loading | error | ready` composition. A failed reload never exposes stale mutable controls as if they were current.
- Main content uses independent settled reads. A failed timeline/summary/thread request becomes an explicit unavailable state, not fake “loading forever” or fake “no data”. Load errors and action errors are separate, and load failures have a retry path.
- Main no longer duplicates Settings-owned pause/delete/app-policy/Recent Episodes controls. **Continue is the primary action surface; Timeline remains the primary history/audit surface.**
- Settings row feedback is row-local; one action cannot leak “Saved/Paused/Deleted” text into another row.
- Retention bounds live in shared contracts and are used by both Host validation and browser inputs.
- The home-grown `document.documentElement.lang` + `MutationObserver` locale path is gone. The client uses DSH rc.2 locale registration/binding and a typed `computer-history` namespace.
- Main and Settings registrations declare the namespace so mounted UI follows locale revisions through the slot renderer.
- English and Chinese dictionaries must have the same keys and placeholder structure; `client-locale.spec.ts` enforces that.
- DSH runtime modules used directly by the client are explicit loader dependencies/externals rather than accidentally bundled implementation copies.
- Styling lives in one scoped stylesheet and uses only Host tokens already verified for this plugin.

No release/version/tag/publish/merge action was performed.

## File ownership: do not blur these boundaries

- `src/client/api.ts`: the only owner of client HTTP transport and Host route/body knowledge.
- `src/client/api-route.ts`: document-relative route construction; suffixes are typed as `/${string}`.
- `src/client/store.ts`: the single shared owner of control state (`state`, `policy`, `retention`) and control mutations; instantiate it in `apply(ctx)`, never at module scope.
- `src/client/panel.ts`: Main content only — status, first-run/stale notices, timeline, summaries, resume, work threads.
- `src/client/settings.ts`: `settings.section` registration only.
- `src/client/settings-view.ts`: Settings loading/error composition only.
- `src/client/settings-rows.ts`: semantic rows and row-local pending/feedback state.
- `src/client/locale.ts`: owned UI copy and capture-word presentation.
- `src/client/styles.ts`: one scoped stylesheet; views should not grow new inline design systems.
- `src/host/api/routes.ts`: Host HTTP boundary. Do not split it merely because it is long.

Main must not regain Settings-owned controls such as pause/resume, delete-all, app-policy editing, or a second Recent Episodes list. **Continue is the first actionable surface; Timeline is secondary evidence/history and must never be a prerequisite for Continue.**


## Phase 2A contract: raw Episodes are evidence; Activities are the reader-facing timeline

The timeline API now carries **both** layers. Do not collapse them back into one concept:

- `TimelineDay.episodes` / `episodeCount` are the unchanged raw audit episodes. They remain available for drill-down and evidence. Main must not render them as the primary timeline rows.
- `TimelineDay.activities` / `activityCount` are the deterministic reader-facing projection. **Main renders `activities`.**
- `TimelineActivity.episodeIds` and `representativeEpisodeId` preserve the path back to raw evidence. Clicking a merged Activity must still let a reader inspect the underlying Episode times.
- Activity merging belongs to `src/shared/audit-view.ts`, not React. A view must not recreate or tweak the merge heuristic locally.
- The current merge rule is deliberately conservative: same local day + same app + same explicit work identity (`threadKey`, workspace id/root, otherwise exact resource URI) + gap no greater than `TIMELINE_ACTIVITY_MERGE_GAP_MS` (10 minutes).
- Do not merge on workspace title alone. Titles can collide and Terminal home-directory titles can be usernames.
- `observedDurationMs` is the sum of time actually present in raw Episodes. `spanDurationMs` is the elapsed first-to-last span of a merged Activity. They are **not interchangeable facts**.
- The UI may use the span to describe a merged human-scale Activity, but must mark it approximate (`about` / `约`). Exact isolated Episodes use observed duration.
- Day summaries count Activities, not raw Episodes. If any Activity is merged, the displayed day duration is approximate for the same reason.
- Tests in `tests/unit/timeline.spec.ts` are the contract for merging, non-merging, resource fallback, and raw-vs-projected counts. Change the rule only by changing these tests deliberately, not by tuning the UI until a screenshot looks nicer.

Current rendered evidence on the user's real Desktop Host: the six raw Episodes from 2026-10-03 project to four Activities. Three VS Code Episodes at 15:17, 15:24 and 15:26 merge into one `15:17–15:26` Activity, while three Terminal Episodes hours apart remain separate. The merged detail still exposes all three original segments.


## Phase 2B contract: Continue is an explicit, evidence-bound Host action

Resume is no longer only a hint. The UI now closes the loop with a real `Continue` action, but the opener is intentionally narrower than a general “open this path” API:

- `GET /api/computer-history/resume/open` returns Host capability. Main only renders Continue when the Host explicitly reports `available: true`.
- `POST /api/computer-history/resume/open` accepts an `episodeId` and an optional `resourceCanonicalUri`. The browser never sends an executable, command line or arbitrary local path.
- The Host reloads the Episode from stored history. If `resourceCanonicalUri` is present it must exactly match a resource already attached to that Episode; a forged URI is a 400 even on an unsupported platform.
- With no named resource, the opener may fall back to the Episode's recorded absolute workspace root. It may not infer another path from display text.
- The verified macOS implementation lives in `src/host/resume/opener.ts` and uses the existing injected `dsh-subprocess` service. `argv` is explicit and never shell-interpreted: `/usr/bin/open -b <stored bundle id> <validated target>`.
- URL targets are limited to recorded `http:` / `https:` resources. Local targets must be valid `file:` URIs. Unsupported schemes never reach the OS opener.
- macOS is the only verified platform in Phase 2B. Windows/Linux return `platform-unverified`; do not bolt on `cmd /c start`, `xdg-open`, shell scripts or other guessed launchers without platform-specific evidence/tests.
- The UI action is user initiated. Reopening a recorded resource is not a new capture primitive and must not weaken the metadata-only boundary.
- Keep the global capability optional. A broken/unavailable opener must not poison Timeline/Thread loading or turn the page into an error state.

Real Desktop evidence: from the live DSH renderer, `GET /resume/open` returned available; a stored VS Code Episode for `docs/validation-three-platforms.md` was POSTed through the same typed route and returned `opened`; the full UI `Continue` click then moved the foreground application from DeepSeek Harness to Code. VS Code's Accessibility tree showed the active window/resource as `validation-three-platforms.md` at `~/Projects/dsh-computer-history/docs/validation-three-platforms.md`.

## Explicit Continue execution contract

The native `@ Computer History` capsule is not a request for a history summary. It is an explicit **action intent**.

- Capsule-only submission means: inspect authoritative current workspace/file/Git state, then make concrete progress on the recorded work in the same turn.
- If the user types text outside the capsule, that text is the specific task instruction and takes precedence over generic continuation.
- Do not begin with a recap of Computer History, reveal/narrate the hidden handoff, or ask the user to restate context that can be recovered by inspecting authoritative sources.
- The explicit capsule may direct the Agent to use normal DSH workspace/file/version-control tools, including reading current files and Git diff. This does **not** weaken Computer History's privacy boundary: the plugin itself still records only metadata and never captures file contents or diff contents.
- Historical verification events are baselines, not current truth. A recorded failure should be reproduced/diagnosed with project-native current tooling before claiming it fixed; a recorded success should be rerun after relevant changes.
- A clean current Git probe is not evidence that the task is complete.
- Ask the user only after authoritative inspection still leaves incompatible next actions, a required source is unavailable, or a real user decision is required.
- Keep this aggressive behavior scoped to **explicit Continue capsules**. Automatic resume hints remain conservative and must not silently turn a weak resume guess into autonomous work.
- Explicit Continue may attach a `priorThreadTail`: at most three immediately preceding Episodes with the **same explicit threadKey**, each separated by no more than 30 minutes, and each carrying auditable citations. This tail is always lower-priority historical evidence and must be labelled `[prior-same-thread]` in model context.
- Never bridge an unthreaded browser/URL Episode into a workspace thread merely because it happened nearby in time. One narrow closed-loop bridge is allowed for explicit Continue only: the immediately preceding and selected Episodes must share the same explicit threadKey, the entire span must be <=30 minutes, and the **sole** Episode in between must have no workspace/threadKey and contain only URL resources on browser surfaces. Boundary evidence must match one complete pattern, never a mixture: either the workspace-switch loop (`previous.end=workspace-switch`, `anchor.start=workspace-switch`, `detour.end=workspace-switch`) or the real Editor/Browser Companion collector-switch loop (`previous.end=collector-restart`, `detour.start/end=collector-restart`, `anchor.start=collector-restart`). That middle Episode is exposed only as `[bridged-url-detour]` reference evidence, never as current state or instructions.

## Native Continue capsule contract

`Continue` means **continue in DSH**, not reopen the previously foreground application.

- The primary action resolves a real DSH Workspace only when the Episode has a trustworthy recorded workspace id/path. If no trustworthy local workspace exists (for example URL-only history), create an ungrouped Session rather than attaching the continuation to whichever coding Workspace happened to be used recently. Insert one native Lexical `ReferenceChipNode` through the public Conversation input facade. Never create a draft in one Session and then move it to another workspace: DSH transfers that draft as clipboard text and structured reference occurrences are lost. Do not emulate the chip with HTML, DOM mutation, hidden textarea text, or CSS.
- The chip owner is `computer-history`. Its visible label is `Computer History`; no custom appearance is needed, so DSH renders the standard `@` reference capsule.
- The draft chip carries only an opaque local Episode ref so DSH can restore the native node. Its clipboard/submission text is the identifier-free `@"Computer History"`. **Never put ResumeHandoff JSON, Git state, file lists, prompts, instructions, or Episode ids into visible/clipboard chat text.**
- The source codec submits only the identifier-free marker `@"Computer History"`. The exact Episode id is held in the local `continuation_sessions` binding keyed by the fresh DSH Session id; it is not written into chat text.
- The local Session→Episode binding is the authoritative attachment identity. `continue-router.ts` installs a standing **agent-scoped** `system-prompt/assemble` listener; when the current Agent Session has a valid continuation binding and an open turn, that mandatory assembly seam deterministically contributes the bounded `ContinuationBootstrap` for every step of that first continuation turn. Do not depend on `agent/inbox/claimed` to arm the Bootstrap: real Desktop composition exposed scope/event-delivery differences that fixture-only tests did not. A typed lookalike marker in an unbound Session still does nothing because it creates no binding.
- The automatic Bootstrap contains only the minimum start state: a bounded prior DSH task projection (direct user/assistant text only, currently at most 4 items / 2400 characters total), workspace identity, at most two local targets and two URL targets, current Git shape/HEAD drift, verification interpretation, and the deterministic `firstPass` order. It must never contain Episode ids, observation ids, Episode summary prose, full Handoff evidence, tool output, reasoning, sourced plugin messages, or the full previous-session snapshot.
- When a `sessionQuery` provider is already present, the prior task projection may use its public `ctx.sessionQuery.readSurface()` exact-read seam. It is an **optional enhancement, never a Host inject prerequisite**: stock Desktop rc.2 does not necessarily load a session-query provider. If it is absent or unreadable, Computer History must still start normally and Continue falls back to current user text plus metadata/Git/URL locators; deeper previous-session context remains available on demand through the official session-reference resolver.
- `computer_history_continue` is optional deep history/evidence retrieval **during the continuation turn**. It resolves the same Session binding into `continuationBrief`, the structured metadata-only `handoff`, and—when requested by the model because the Bootstrap is insufficient—a bounded previous-DSH-session snapshot through the official `sessionReferenceResolver`. At `agent/turn-stopping` or `agent/error`, the router consumes/unbinds that Session→Episode attachment so later ordinary turns cannot silently inherit stale continuation state.
- The full handoff must **not** be persisted as a sourced `UserMessage`: DSH renders those as expandable `ContextInjectionRow` entries. Do **not** rewrite the admitted user message in `agent/pre-step`: DSH persists the message. Keep the identifier-free `@"Computer History"` marker as durable user text so DSH can project the sent message back to a reference chip. The automatic Bootstrap lives in the system-prompt path and the composer/chat remain prompt-free.
- A new Session must be blank before insertion. Prepare it under a temporary `sessions.retain(...).ready` before navigation so Composer initialization cannot overwrite the chip. If insertion/binding/navigation fails, clear the prepared draft and remove any continuation binding before surfacing the failure; the public Session API has no delete operation, so an unreachable empty Session may remain but must carry no ghost chip or ghost binding.
- The old Host `resume/open` action remains a secondary **Open in app** action. It is no longer the meaning of Continue.
- Follow the platform seams: resolve `ctx.workspaces` when trustworthy → `ctx.sessions.create({ workspaceId })` or ungrouped/cwd fallback → temporary `ctx.sessions.retain(...).ready` → `ctx.sessions.scope` → `ctx.conversation.input.for(scope).insertReference` → persist the continuation binding → `ctx.uiWorkspace.openSession` → release the temporary retain. Do not reach into Lexical internals.
- The `computer-history` reference source is registered through `ctx.inputTriggers.registerSource` so submission serialization is owner-routed exactly like DSH's built-in file/session references.

## Work Continuity contract: Continue is the product center, not a Timeline shortcut

The current product direction is **work continuity for the DSH Agent**, not usage analytics and not screenshot recall. Preserve these invariants:

- `Episode` remains the auditable evidence unit. `ResumeHandoff` is the compact Agent/UI projection. Do not make the Agent parse generic Episode summary prose to continue work.
- Main's Continue card must load from recent Episodes directly (`/recent`), **independent of Timeline availability**. A failed/empty Timeline must not hide a valid continuation.
- The client reads several recent Episodes and skips Terminal-only activity when choosing the Continue card, so a shell window cannot displace a workspace/file the user can actually reopen.
- Returning focus to DSH refreshes recent history and the handoff. Git state is current-state metadata and can change without producing a new Episode, so treating the initial page load as authoritative is wrong.
- Editor `save` is trusted companion metadata only. It means 'this editor reported a save', not 'the contents are correct'. Native accessibility collectors cannot assert it.
- Build/test verification is also narrow metadata: VS Code task group + exit result. Do **not** add command strings, stdout/stderr, diagnostics, selections, or file contents to make the card more descriptive.
- Git enrichment is branch / HEAD / dirty paths / porcelain status only. No diff content and no commit-message scraping by default.
- DSH checkpoints are metadata-only turn boundaries (`sessionId`, `turn`, `cwd/workspace`, time, optional HEAD). They do not store user or assistant message text. Subagents are excluded.
- A handoff says what was **observed** and points to authoritative places to verify. It must never phrase metadata as guaranteed task truth.
- The user-facing hierarchy is: **Continue action → compact state summary → recent saved resources → optional technical disclosure → Timeline/history below**. Do not turn the top card into an inspector dashboard.

This is the differentiation from ActivityWatch/Recall-style products: Computer History should answer **'where did my work stop, what verifiable state is it in, and how can DSH continue it?'**, not merely 'what did I use/see?'.

## Agent Work State contract for the native Continue capsule (2026-10-06)

The capsule is a context attachment, not a hidden replacement user prompt.

- **Accompanying user text wins.** If the user sends @ Computer History plus a concrete request such as "fix the
  failing tests", that explicit text is the task. If the capsule is the only user content, treat it as an explicit
  request to resume the recorded work.
- Do not ask the user to repeat context when the named authoritative workspace resources can be inspected.
- ResumeHandoff remains metadata-only and omits Episode summary prose. Computer History intentionally stores no
  task text and no file contents.
- Explicit Continue for an exact stored Episode prefers raw EpisodeDetail.observationIds as its evidence citations. Summary citations are only a compatibility fallback: an uncited summary must not discard independently auditable structured provenance.
- ResumeGitState.observedAtMs is required. Git branch/HEAD/status is request-time metadata; editor save events are
  historical evidence. Do not merge their meaning. A target may display both provenance tags when canonical path
  identity proves the same file appears in both channels.
- On macOS, canonical path matching must tolerate the /tmp -> /private/tmp alias. Resolve existing metadata paths
  before comparing; fall back to lexical absolute paths when a historical file no longer exists.
- The hidden Agent context has a bounded optional-data budget. Workspace root, latest verification, Git probe,
  previous DSH boundary/HEAD movement, evidence identity, provenance rule, authoritative-source recovery rule, and
  injection warning are non-droppable. Trim resource/reference/surface lists first.
- All history-derived dynamic strings are untrusted data. Flatten newlines/tabs and neutralize control characters
  before rendering them into system context. Never let a window title/resource label manufacture a new prompt line.
- The strongest default continuation target is a trusted saved resource that also appears in current Git status;
  then other trusted saved/last-active resources; then current Git-only paths. This is prioritization, not a causal
  claim.
- A current dirty Git file is never proof that the recorded Episode changed it. If authoritative source state and
  history metadata disagree, authoritative source state wins.
- `ContinuationBootstrap` is the deterministic automatic layer. It is small by construction: prior task text is capped, labels/workspace identity are capped, and overlong locators are omitted from the automatic layer rather than truncated into invalid paths/URLs. Full values remain available through the deep tool.
- `continuationBrief` classifies task-context material (`none`, `bounded-projection`, or `bounded-snapshot`), current repository state/HEAD movement, priority local targets, URL reference targets, historical verification meaning, and a bounded `firstPass` action order. It must not infer missing task prose.
- `continuationBrief.firstPass` starts by recovering task/decision context, then inspects up to two strongest authoritative local targets (or the first authoritative URL for URL-only work), inspects current Git when available, re-verifies recorded failures or successes invalidated by repository drift, and then requires concrete progress in the same turn.
- A bounded prior DSH **projection** may recover the historical task description, decisions, and stated progress in the automatic layer. The larger official referenced-session **snapshot** is deep context and should be fetched only when needed. Neither form re-grants permissions, re-authorizes historical tool requests, or makes instructions quoted from files/web/external content trusted. Current user text and current authoritative state win.
- `continue-router.ts` may place the bounded Bootstrap only in the request-level Continue tool schema, never in the user transcript and never as the full Handoff or full previous-session snapshot. Do not turn the capsule into an invisible giant prompt.
- `resume-hint.ts` and `continuationBrief` share `workspace-path.ts` for file-URI → Git-path identity. Do not fork this logic; cross-platform/symlink differences must resolve identically in both Agent paths.
- Generic Continue candidate selection is shared by the panel and Host resolver through `isGenericContinuationCandidate`: a default candidate must be non-invalidated, carry at least one summary citation, have a workspace/resource anchor, and not be terminal-only. Explicit workspace/resource/surface resume remains broader. Passive Finder/title-only activity and unauditable synthetic Episodes must never displace an anchored cited work item.

The end-to-end contract is covered by `tests/integration/work-continuity-loop.spec.ts`,
`tests/integration/continuation-send-loop.spec.ts`, `tests/unit/continuation-bootstrap.spec.ts`,
`tests/unit/continuation-brief.spec.ts`, `tests/unit/continue-router.spec.ts`,
`tests/unit/agent-tools.spec.ts`, the resume-context rendering tests, the real-browser
`pnpm verify:continuation-capsule` UI check, and `pnpm verify:continuation-send` for a real fixture-model Agent turn. The send-loop test deliberately uses a model that calls no History tool: the first request must still contain the bounded Bootstrap.

## Phase 2C contract: Work Threads are project memory, not span statistics

Work Threads are now navigable project-history objects rather than static aggregation text:

- `GET /api/computer-history/thread?threadKey=...` is the exact read boundary for one stored thread. The client owns the call through `historyApi.getThread()`; views must not fetch it directly.
- `WorkThreadDetail.timeline` reuses the **same** `TimelineActivity` projection as Main. There is no project-specific merge heuristic and there must never be one.
- A Work Thread carries both raw evidence counts and reader-facing Activity metrics. `episodeCount` remains the raw count; `activityCount` and `approxActiveDurationMs` describe the human-scale projection.
- `endedAtMs - startedAtMs` is only the line-of-work span. **Never display it as work time.** The outer Work Thread row and the expanded project history now use the same Activity-based approximate duration, so a project spanning overnight does not become “13 hours of work”.
- The inline project-history inspector shows the thread's own day-grouped Activity timeline. It is intentionally a lightweight drill-down inside Main, not a second settings page, dashboard, or navigation framework.
- Main history initially shows at most seven active dates. It requests one extra date as a probe (`days=8`) and only renders “Show earlier history / 查看更多历史” when that eighth date actually exists. Expanding uses the same rule (`14 visible -> request 15`) so the UI never guesses that older history exists.
- “Show earlier history” expands the current history read only. It does not mutate retention, create pagination state on the Host, or turn Main into calendar analytics.
- Project history may eventually expose Continue for a stored resource, but it must reuse the Phase 2B opener. Do not create a thread-specific arbitrary-path launcher.

Rendered verification in the isolated real DSH Host: `dsh-computer-history` now reads `2 个活动 · 约 15 分钟` in the Work Threads list; expanding it shows two project Activities across two dates with the same ~15-minute total. A synthetic, non-persistent Timeline response proved the older-history control: 8 returned active dates render 7 plus the button; clicking requests 15, a 10-date response renders all 10 and removes the button.

## Phase 3 productization contract: remove developer rituals before adding features

Read `docs/product-friction-audit.md` before changing setup, companions, permissions, update/recovery, or Settings. Its core rule is a product contract:

- Never make copying a token, port, Bundle ID, filesystem path, command, or config value the normal path when the product can safely perform or discover that step itself.
- Manual token/port/path/CLI flows belong under Advanced/Diagnostics after an automatic or one-click path exists. Do not cosmetically rename a development procedure as “one click”.
- Browser distribution on normal macOS/Windows is a store/distribution problem, not a CSS problem. The current unpacked Chromium directory is a verified development fallback. A consumer flow requires a published stable extension identity and an authenticated desktop bridge; the locally installed ChatGPT/Codex integration proves Native Messaging is a viable precedent, not code to copy.
- Accessibility setup is now a proven macOS fixed action: the verified System Settings URI is Host-owned and takes no browser-provided URL. After opening settings, the UI should refresh when the user returns rather than asking for an “I did it” confirmation.
- First-run completion is a fact, not a button click. Writing allow rules alone must never dismiss onboarding while capture is paused, degraded, permission-blocked, or has never successfully produced history.
- A Host API is not the same as a shipped product feature. Track three layers separately: (1) Host/contract exists, (2) Client surface exists, (3) normal-user distribution and live flow are verified. Only layer 3 is product-complete.
- Likewise, do not claim “applications and sites” are managed while the Settings surface only edits app rules. Product copy must not overclaim the policy UI.
- Do not invent DSH update/reload/uninstall APIs. The rc.2 packages inspected so far expose no proven client action for those operations; mark them **needs verification** until an actual platform seam or working precedent is found.

## Platform facts that are now proven on rc.2

`@deepseek-ai/dsh-client-locale` is a real registered client module. Official `dsh-client-ui-layout@0.2.0-rc.2` injects the `locale` Cordis service and its manifest injects this module id. The locale package itself documents and types `ctx.locale.register`, `bind`, `getLocale`, `getSnapshot`, and `subscribe`.

Therefore locale is no longer a "needs verification" item. Use the platform service; do not restore DOM-language observation.

## Product-completion contract: remove developer rituals, not just developer-looking UI

A feature is not productized merely because its token/path/command was moved under Advanced. For every user journey, ask: **can the product safely do this itself after one user intent?**

- Normal flows must not ask users to copy/paste Bundle IDs, ports, pairing tokens, filesystem paths, update commands, or internal reason codes when a fixed Host-owned action can do the same work.
- Keep manual IDs/tokens/paths only as Developer setup / Diagnostics fallbacks until the production path exists.
- Do not fake one-click installation. Browser extension installation for normal users requires a real supported distribution path and stable extension identity; an unpacked extension is a development fallback, not a consumer installer.
- Installation and pairing are separate problems. A one-click VSIX install is not product-complete while the editor still requires a copied token/port. Browser/editor automatic bootstrap must preserve the authenticated trust boundary rather than bypass it.
- Destructive intent must stay explicit. "Stop recording this app" changes future policy only; deleting its past history is a separate destructive action with its own confirmation.
- Permission prompts owned by the OS/browser remain user decisions. The product should navigate directly to the authoritative surface and automatically re-check on return; it must not claim it can grant permission itself.
- Do not invent platform inventory/update/reload/uninstall APIs. If rc.2 has no proven seam, label the gap **needs verification** rather than building a shell/CLI workaround into the normal UI.
- Product-complete means all three are true: (1) Host/contract capability exists, (2) normal Client flow exists, and (3) the installed/distributed flow has been live-verified. Backend-only and hidden developer setup are not "done".

The current friction inventory and priorities live in `docs/product-friction-audit.md`; update that document when a friction item changes status rather than starting a second checklist.

### Productization facts live-verified on macOS (2026-10-04)

- Installed-app selection is no longer a Bundle-ID guessing exercise: `/system/applications` queries only the fixed supported adapter identities through the verified macOS inventory path and Settings shows the applications actually present. First-run may narrow its preset with that inventory; if inventory is unavailable, preserve the existing preset rather than infer a platform from string shapes.
- VS Code companion setup is a real normal-user flow: a Host-owned bundled VSIX is installed with fixed argv, using `code` when available or the standard VS Code.app CLI when the shell command was never installed. The Host stages an editor-only short-lived credential in a `0600` handoff; the extension moves it to SecretStorage and deletes the handoff. Never restore visible token/port settings.
- VS Code companion version drift is product state. Compare the installed extension version with the bundled version; an older companion says `Update available` and the same Host-owned install action updates it with `--force`. Do not show stale extensions as healthy merely because they have connected before.
- About → Diagnostics exports runtime health only. The report must continue to exclude history, resource names/URIs, filesystem paths, loopback ports, credentials, update commands and other content-bearing data.
- Browser production install is **not** complete. Until there is a published store extension with stable identity and a reviewed authenticated desktop bridge, normal UI must say the production path is unavailable/development-only and keep Load-unpacked/token/port under Developer setup. Do not create a temporary URL-token or auto-Developer-Mode protocol just to simulate one click.
- Do not add a `Restart collector` button yet. Current crash recovery and capture-lock release are not one proven lifecycle operation; a repair action must first guarantee single-owner reacquisition. Likewise, no rc.2 plugin update/reload mutation seam has been proven. These stay **needs verification**, not shell-command buttons.


## Non-negotiable rules for DSA / future agents

1. **Metadata-only means metadata-only.** Never add screen contents, document text, selections, keystrokes, clipboard contents, or screenshots. ADR 0002 is a product boundary.
2. **Use an existing DSH precedent before inventing an API.** Inspect the installed rc.2 type declaration and/or an official/working plugin. If still unproven, explicitly mark it “needs verification” and stop there.
3. **Never guess `dsh.client.inject`.** Every id must be a real ModuleLoader client id. Unknown ids can silently remove this plugin's client entry.
4. **Do not copy another plugin's manifest blindly.** In particular, do not add `@deepseek-ai/dsh-client-ui-primitives` just because another bundle mentions it; this Host has already shown that an unregistered id breaks bootstrap.
5. **HTTP has one owner: `src/client/api.ts`.** Add a typed API method and a behavioral test before a view uses a new Host operation.
6. **Control state has one owner: `src/client/store.ts`.** Never restore per-row `/state`, `/policy`, or `/retention` fetches.
7. **Store lifetime belongs to the plugin application.** Create one store in `apply(ctx)` and pass it to Main + Settings. Do not export a browser-global singleton just because both surfaces need the same data.
8. **Fold canonical mutation responses.** If POST returns new state/policy/retention, publish it directly; do not POST then refetch unrelated endpoints.
9. **DSH owns the Settings shell.** Register into `settings.section`; do not draw another outer settings card/frame/page title.
10. **UI copy is typed locale data.** Add a dictionary key in both `en` and `zh`, keep placeholders identical, then call `t(key, params)`. No `t(en, zh)`, no `document.lang`, no `MutationObserver`.
11. **Theme tokens are a closed set on this Host.** Use only the 14 measured aliases unless a new token is independently verified at runtime. Do not copy `layer-3`, `tertiary`, `dimmed`, etc. from Vision Router.
12. **Do not make every datum a button or card.** Timeline entries should read like history; controls should visually remain controls.
13. **Keep zero runtime dependencies unless a concrete requirement proves otherwise.** React 18 and browser/DSH primitives are enough for this UI.
14. **Keep runtime module ownership explicit.** A direct runtime `@deepseek-ai/...` import used by the client must be represented consistently in peer dependencies, the loader inject list, and build externalization. Do not accidentally bundle DSH client plugins into `lib/client.js`.
15. **Protocol states are not booleans.** Do not infer “resume” from “not running”. Capture controls are valid only for the exact Host states that define the transition: `running → pause`, `paused → resume`.
16. **Loading is not empty/off/unavailable.** An unresolved or failed request must not become a factual “no history”, “not recording”, “not authorized”, or “companion unavailable” state.
17. **Invalidate derived UI after destructive writes.** Deletion/forget operations must clear detail, hint, preview, or other projections that may refer to removed records before reloading content.
18. **Use the slot contract instead of defeating it.** If a registration declares `locale`, consume its injected `t` prop. Do not use `as never` to silence a composition mismatch that can be expressed by platform types.
19. **No release actions.** No version bump, tag, publish, release workflow, or merge-to-main without explicit user authorization.

## How to make the next change

1. Identify which boundary owns the change (API, shared control state, Main content, Settings row, locale, or styles).
2. Find an rc.2 platform precedent before adding any DSH service/module/slot behavior.
3. If Host I/O changes, update `api.ts` first and add/update a client API contract test.
4. If both Main and Settings need the fact, put it in the shared store; otherwise keep content/transient state local to its surface.
5. If user-facing copy changes, update both locale dictionaries with matching placeholders.
6. If visual styling changes, use the scoped stylesheet and only verified aliases; inspect the rendered Host before inventing geometry.
7. Run focused tests while editing, then the full verification commands below.

## Decision protocol for DSA when the user says the UI is ugly / foreign

Do **not** immediately add cards, component abstractions, tokens, animation, or dependencies. Use this order:

1. Inspect the exact rendered Main/Settings surface in the user's Host. If you cannot see it, say that rendered evidence is missing instead of guessing.
2. Compare against a native Host surface and a proven plugin inside the same Host. Copy platform ownership patterns first (`settings.section`, locale, lifecycle, tokens), not the other plugin's arbitrary CSS or manifest.
3. Separate **correctness** from **polish**. Broken route/state/loading/error/accessibility behavior is fixed before spacing or color.
4. Identify who owns the UI concept. DSH owns Settings shell/navigation; this plugin owns only its rows/content. Main owns history reading; Settings owns policy/control changes.
5. Make the smallest visual change that explains the screenshot difference. Prefer one CSS rule or one semantic component boundary over a new mini design system.
6. Verify the rendered result in light and dark themes, keyboard focus, disabled, loading, empty and error states. A green unit test is not evidence that the UI looks native.
7. Only then continue. If the evidence does not justify another abstraction, stop.

When proposing any DSH API/module/slot not already proven in this repository, inspect rc.2 types/source or a working runtime example first. If still uncertain, write **“needs verification”** and do not code against the guess.

## Next work

**Phase 2 is complete:** Timeline Truth, Resume Loop, and Project Memory are all implemented and verified. Do not keep expanding Phase 2 just because another feature can fit on the page.

Before starting a Phase 3, get a product decision from the user. Reasonable candidates are identity/continuity polish (real verified app identity/icon sourcing, stronger resource naming, richer project resume) or a deliberately scoped semantic summary experience. Do not choose one autonomously and do not turn Computer History into analytics by default.

Still out of scope unless the user explicitly changes direction: productivity scores, app-usage pie charts, heatmaps, surveillance-style activity scoring, AI daily/weekly narratives, and a broad analytics dashboard.

## Required verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm verify
pnpm build
```

Useful ownership checks:

```bash
grep -R -n 'fetch(' src/client
grep -R -nE 'MutationObserver|document\.documentElement\.lang|navigator\.language' src/client
grep -oE 'require\("[^"]+"\)' lib/client.js | sort -u
```

Expected: business `fetch` only in `src/client/api.ts`; no DOM-locale observer; every non-React runtime require is an intentionally injected/external DSH module.

## Verified baseline after AM pass

- `pnpm verify`: green.
- **64 test files / 401 tests passed.**
- lint: 0 errors; 1 warning remains in the DSA's parallel `tests/unit/protocol-bounds.spec.ts` work (`consistent-function-scoping` on its local `hello` helper). It is unrelated to Phase 2 and AM deliberately did not edit that concurrent work just to clear the number.
- privacy / adapters / store-protection / semantic-boundary / architecture / migrations / native-timeouts / docs / CI boundary / collector checks: green.
- Phase 2 focused contracts are green: Activity merge/non-merge rules, exact thread route/client encoding, Work Thread Activity duration, Resume opener validation/fallback, locale parity, and existing control-state/API tests.
- `pnpm build`: green. Existing tsdown CJS/declaration warnings remain informational.
- Final Phase 2 preview bundles: client CJS 114.91 kB / gzip 26.55 kB; Host ESM 235.32 kB / gzip 55.71 kB. Treat sizes only as ownership sanity checks, not product KPIs.
- Current `lib/client.js` runtime requires remain platform-owned DSH client modules plus React; repository tests guard externalization/inject/peer ownership.
- The Desktop Host uses a copied installed plugin under `~/.dsh/profiles/desktop/node_modules/dsh-computer-history`, not a symlink. AM copied the final clean-worktree Phase 2 `lib/client.js` + `lib/index.js` into that preview installation **without restarting the user's live Desktop process**, so the next normal restart will load Phase 2C without interrupting current work.
- Phase 2C was rendered and interaction-checked in an isolated real DSH `uiqa` profile against the same Computer History store; the synthetic older-history check intercepted only the read response and wrote no history data.
- No release action has been taken; the working tree remains for review/testing.

### Productization contracts added 2026-10-05

- Capture recovery is a fixed Host capability, not a shell/restart recipe. `recover()` must reacquire capture ownership first and must not resolve until the new collector has acknowledged its desired state **and** the current policy configuration. Multi-Host contention must remain fail-closed.
- Semantic/model UI must be driven by Host provider readiness. A provider that is not wired/configured must not accept an opt-in or be presented as enabled. Deterministic summaries remain truthful fallback.
- App identity has one client naming source. On macOS, system app icons come only from the fixed supported installed bundle-id inventory; the renderer never supplies or receives app filesystem paths. The icon endpoint accepts bundle IDs only and text badges remain the cross-platform fallback.
- Settings → Data → Privacy check is explanatory only. It reuses `/audit/preview` / ingestion predicates, shows human reason categories and counts, and must not expose scope keys, observation IDs or raw policy strings in the default UI. Do not turn it into a second policy editor.
