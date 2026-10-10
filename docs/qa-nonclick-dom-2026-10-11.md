# v1.1 AI-first — non-click DOM and accessibility acceptance

Status: **PASS for the tested DOM and independent Chromium component geometry. Native Electron and full DSH desktop shell remain UNVERIFIED.**

## Scope
The tests mount the actual `AskHistoryView` through React DOM in jsdom, using real DOM
events from Testing Library / user-event and mocked History APIs. No user data, history
database, model or desktop collector is accessed. This is more realistic than calling a
component as an unmounted function or mocking its React Hooks, but it is not a deployed
Electron window or the entire DSH Host settings page.

Run from a checkout with the new dev dependencies installed:

```sh
pnpm build
pnpm exec vitest run tests/integration/ask-history-dom.spec.ts
pnpm check
```

## Verified DOM contracts
1. English UI: open History search, edit question, AI draft callback separate from local query.
2. Same-named search results: both have accessible source/Continue actions; their source
   regions remain associated with the exact clicked hit.
3. Rapid DOM double-click on Continue: only one callback before async settlement.
4. AI exact Episode bridge: preview first, independent user confirmation, expired-source
   rejection on second authoritative fetch.
5. Mismatched/forged Episode ID: visible alert, no Continue button.
6. Keyboard Tab and Enter, including expected Tab skipping of disabled controls.
7. English and Chinese panel: axe-core WCAG 2 A/AA + 2.1 A/AA semantic checks, with
   color-contrast intentionally excluded because jsdom has no real rendering/canvas.
8. Out-of-order source fetch responses: late stale source cannot replace the newer hit.
9. CSS breakpoint rule guard for form/input/buttons at <=560px; this is a **source
   regression check**, not proof of actual 420/600px measured layout.

## Additional independent Chromium layout acceptance (2026-10-11)

The actual React DOM from the synthetic-only QA mount was captured with the
real `AskHistoryView` event handlers after expanding search, opening one local
source card, and inspecting a separate exact Episode ID. An independent
container Chromium layout engine rendered this inert HTML and exact
`FOUNDATION_STYLES`, `ASK_HISTORY_STYLES` and `RESPONSIVE_STYLES`.
English and Chinese were checked at **320, 420, 560, 600, 1024 and 1280 px**.
All **12 viewport/locale pairs** had zero document-level horizontal overflow
and zero visible element boxes extending beyond the viewport, including a
deliberately very long synthetic CAD resource label.

The same measurements found a concrete accessibility gap: the two source
inspection text buttons were **22 px high**. Adding `min-height:28px` to
`.ch-ask-hit>.ch-text-action` made both **28 px high**, with all 12 layout
pairs remaining overflow-free. The CSS rule now has a regression assertion.
This establishes geometry for the **Ask History component fixture only**,
not real installed Electron or full Host navigation/Settings layout. Color
contrast, native font rasterization, screen-reader announcements and
visible focus in Electron are still unverified.

The Mac system Chrome could not complete its standalone QA smoke. No
Electron debugger interface was used, nor was any security refusal bypassed.
Screenshots and machine-readable geometry from independent Chromium were
stored in the QA handoff artifacts (not copied into production History).

## Browser / Electron distinction
A standalone **Mac** headless Chrome smoke was attempted on the owner Mac, using a disposable
`--user-data-dir` and a local static page, not any Electron debugger endpoint. It did
not produce a DOM result within the attempt window. A separate independent Chromium
component geometry run, documented above, subsequently passed. The QA-only Chrome process was terminated, leaving ordinary apps untouched.

The following still require acceptance in the complete installed Host shell:
full-panel 420px/600px/desktop overflow and clipping, actual focus visibility,
color contrast, icons, native font metrics and visual regression.

The following remain native Electron-only acceptance:
Host/UI integration, window management, native focus and accessibility tree,
Settings page and app navigation behavior, click-to-Continue and native recovery UX.

No original profile, user database or collector was modified. No release, push or
migration was authorized by these automated test results.
