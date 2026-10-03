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
- Main no longer duplicates Settings-owned pause/delete/app-policy/Recent Episodes controls. Timeline is the primary history surface.
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

Main must not regain Settings-owned controls such as pause/resume, delete-all, app-policy editing, or a second Recent Episodes list. Timeline is the primary history surface.

## Platform facts that are now proven on rc.2

`@deepseek-ai/dsh-client-locale` is a real registered client module. Official `dsh-client-ui-layout@0.2.0-rc.2` injects the `locale` Cordis service and its manifest injects this module id. The locale package itself documents and types `ctx.locale.register`, `bind`, `getLocale`, `getSnapshot`, and `subscribe`.

Therefore locale is no longer a "needs verification" item. Use the platform service; do not restore DOM-language observation.

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

The remaining important work is **rendered visual verification**, not another speculative refactor. Load this exact working tree in the user's rc.2 Host and inspect Main + Settings in light and dark themes. Compare spacing, density, hierarchy, focus, disabled, loading and error states against native Host controls. Adjust only from rendered evidence; do not infer “native-looking” from source code alone.

Connection-reset invalidation is still a possible improvement, but only after verifying the exact existing client event/service precedent. Do not add polling or a second cache.

UI-level component tests are useful only if the existing test stack can render these components without adding a runtime dependency. Highest-value cases are loading/error truthfulness, row-local feedback, and two-step destructive confirmation.

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
- 60 test files / 361 tests passed.
- lint: 0 warnings / 0 errors.
- privacy / adapters / store-protection / semantic-boundary / architecture / migrations / native-timeouts / docs / collector checks: green.
- Focused client contract/state tests are green: API routing/bodies, shared-store folding/coalescing, locale dictionary parity, capture-control state mapping, and stale companion-state replacement.
- `pnpm build`: green. Existing tsdown CJS/declaration warnings remain informational.
- Client bundle: 52.35 kB CJS, gzip 13.42 kB. Treat this only as an ownership sanity check.
- Current `lib/client.js` runtime requires remain platform-owned DSH client modules plus React; repository tests guard externalization/inject/peer ownership.
- The currently running Desktop Host has a copied installed plugin under `~/.dsh/profiles/desktop/node_modules/dsh-computer-history`, not a symlink to this checkout. This working tree has therefore been code/test/build verified, but the newly edited UI has not been silently installed over the user's live Host for screenshot validation.
- No release action has been taken; the working tree remains for review/testing.
