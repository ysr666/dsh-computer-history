# Phase 2.1 — Task list (browser companion)

Status: Ready to execute (owner approved 2026-10-02)
Boundary: ADR 0002 (no content), ADR 0007 (companion trust boundary),
ADR 0004 (semantic enrichment) all apply.

Phase 2.1 is W1 from `docs/plan-phase2.md`. Its purpose is to cover the surface
where most work actually happens, and to retire the roadmap sentence that keeps
browser metadata unavailable — with evidence, not with a promise.

## Exit gate for 2.1

- `pnpm verify:p1` and `pnpm verify` green, with the extension covered by
  `verify:privacy` and by its own unit tests.
- The privacy matrix passes **on real Chrome** (loaded unpacked): incognito
  produces zero rows, a denied origin produces zero rows, an allowed origin
  produces one episode whose resource is the normalised URL.
- `docs/companion.md` documents pairing, the port, rotation, and the exact
  matrix commands with dates.
- The roadmap's "browser deferred" clause is replaced by the evidence.

---

## T2.1-0 — Intake feasibility spike (do first)

**Goal:** confirm the design in ADR 0007 against the running Host before writing
the extension.

**Checks:** can the plugin open its own loopback listener inside the DSH process
(the plugin already runs in the Host's Node context)? does the DSH webserver
reject an unauthenticated request to `/api/computer-history/*` (expected: yes,
which is why the intake cannot live there)? which port is free?

**Deliverable:** a short section in `docs/validation-phase2-1.md` with the
answers and the chosen port.

**Acceptance:** the spike runs against the real Host, not a stub, and the port
choice is recorded with the command that proved it free.

## T2.1-1 — Pairing and token storage

**Write scope:** `src/host/companion/token-store.ts`, the store migration if a
table is needed, `src/host/api/routes.ts` (expose pairing state),
`src/client/index.ts` (show the token once, rotate it).

**Deliverable:** 256-bit token generated on first need, stored in the database,
never written to a world-readable file; rotate invalidates the previous value.

**Acceptance:** unit tests for generate/rotate/reject; the panel shows the token
once and a rotate action; `verify:store-protection` still passes (no new file).

## T2.1-2 — Companion intake

**Write scope:** `src/host/companion/intake.ts`, `src/host/plugin.ts` (start and
stop it with the plugin), `src/shared/contracts` if a payload type is needed.

**Deliverable:** a loopback-only `POST /companion/observation` that requires the
token, caps the body (`MAX_PROTOCOL_LINE_BYTES` scale), rate-limits per token,
and feeds the existing ingestion path as a companion observation.

**Acceptance:** tests for 401 without a token, 413 over the cap, 429 over the
rate limit, a malformed body, and a happy path that reaches the store; the
listener is closed when the plugin is disposed (no leaked port).

## T2.1-3 — Provenance-aware URL resources

**Write scope:** `src/host/ingestion/normalize.ts`,
`tests/integration/ingestion.spec.ts`.

**Deliverable:** `resource.kind === 'url'` is accepted only when
`source.provider === 'companion'`; the AX path keeps dropping it, and the
companion path strips query and fragment before validation.

**Acceptance:** two tests side by side — an AX-derived URL observation is
dropped, a companion one is stored with a normalised URL; a third pins that a
query string never reaches the store.

## T2.1-4 — MV3 extension

**Write scope:** `extension/` (manifest, service worker, options page, icons,
its own `tsconfig.json`), `package.json` (build and typecheck scripts),
`scripts/verify-privacy-boundary.mjs` (scan the extension).

**Deliverable:** an unpacked-loadable extension that reports tab activation and
navigation for allowed origins: `{origin, path, title, incognito, windowId,
observedAtMs}`. No DOM APIs; incognito bails before anything else.

**Acceptance:** `pnpm build:extension` produces a loadable directory;
`pnpm verify:privacy` fails if a content-bearing API appears in `extension/`;
unit tests (vitest with a mocked `chrome`) cover the incognito bail, the
normalisation, and the no-DOM guarantee.

## T2.1-5 — Panel controls and policy wiring

**Write scope:** `src/client/index.ts`, `src/host/api`, policy shortcuts.

**Deliverable:** pairing state, token rotation, per-origin allow/deny shortcuts
that write `resource` rules, and a "companion unavailable" state when the intake
cannot bind.

**Acceptance:** visual and interaction evidence (screenshot plus a click that
changes state, as in Phase 2.0).

## T2.1-6 — Privacy matrix on real Chrome

**Write scope:** `docs/companion.md`, `docs/validation-phase2-1.md`,
`scripts/verify/chrome-companion.mjs` (launch a throwaway profile with
`--load-extension`).

**Matrix:** incognito window (never reported), denied origin (zero rows),
allowed origin (one episode with the URL resource), a query string in the URL
(never stored), extension disabled (no traffic), token rotated (401 and no
rows).

**Acceptance:** every cell has a command and a result in the report; a failing
cell is a release blocker for retiring the roadmap clause.

## T2.1-7 — Documentation and roadmap retirement

**Deliverable:** `docs/companion.md` (install, pair, rotate, uninstall, what is
and is not collected), `docs/roadmap.md` clause replaced with the evidence
pointer, `docs/verification-guide.md` gains the Chrome recipe.

**Acceptance:** the roadmap no longer claims browsers are deferred, and the
claim it makes instead is the one the matrix proves.

---

## Order

| Step | Tasks | Gate |
|---|---|---|
| 2.1.a | T2.1-0, T2.1-1 | intake design confirmed, token stored and rotatable |
| 2.1.b | T2.1-2, T2.1-3 | authenticated intake feeding the store; URL provenance gated |
| 2.1.c | T2.1-4, T2.1-5 | extension loadable, panel controls work |
| 2.1.d | T2.1-6, T2.1-7 | real-Chrome matrix green, roadmap retired |

## Out of scope for 2.1

Firefox/Safari companions, page content of any kind, per-tab history beyond
activation/navigation, and any remote (non-loopback) intake.
