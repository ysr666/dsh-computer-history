# Phase 2.3 — Task list (UI and audit)

Status: Ready to execute (owner said continue, 2026-10-02)
Boundary: ADR 0002 (metadata-only), ADR 0004 (semantic layer),
ADR 0005 (store protection), ADR 0007 (companion).

Goal: make what the Host knows inspectable, portable and correctable — and close
the Phase 1 findings that were left to a product decision.

## Exit gate for 2.3

- `pnpm verify` and `pnpm verify:p1` green, with the new export/import and F13
  tests inside `pnpm verify`.
- A JSON export **round-trips**: export → import into an empty store → the same
  episodes, observations, resources and policy come back, and the round-trip is
  asserted by test rather than described.
- F13 is closed or explicitly re-decided in an ADR, with a test either way.
- Timeline, episode detail ("why was this recorded"), per-app/per-site controls
  and retention controls are visible in the panel with screenshot evidence, and
  at least one control changes state in a captured interaction.
- `docs/audit.md` documents export/import and the redaction preview;
  `docs/validation-phase2-3.md` records each task with commands and results.

---

## T2.3-0 — plan review

What exists: `recent`, `search`, `episode`, `delete`, `policy`, `pause`,
`resume`, `state`, plus the 2.1/2.2 routes. What is missing: an export/import
path, a redaction preview, the day/week timeline, "why was this recorded", and
the per-app/per-site control surface. The review checks that the JSON shapes
already stored can round-trip without inventing a second schema.

## T2.3-1 — F13: the protected-path title residue

Phase 1 recorded a title-only observation for a window whose document was not
readable at that moment, even though the user had protect rules: the path glob
cannot match a bare file name, and the sensitive-marker heuristic never looked at
titles. The decision (ADR 0008): when the policy contains any protect rule and a
window exposes **only a bare file name** as its title, the observation is
dropped, because the Host cannot tell whether that file lives under a protected
path.

**Acceptance:** tests for the drop, for the surviving cases (a titled window with
whitespace, a window with a readable document that the policy allows, an
untouched policy with no protect rules), and no change to what is stored
otherwise.

## T2.3-2 — Export and import

**Write scope:** `src/host/audit/{export.ts,import.ts}`, routes, tests.

**Deliverable:** `GET /export` produces one JSON document (schema version, policy,
episodes with citations, observations, resources, semantic opt-ins) and
`POST /import` reads it back. The pairing token digest is **excluded**: it is a
credential, not history. Import validates every field, refuses an unknown schema
version, and is idempotent for the same document.

**Acceptance:** a round-trip test seeds a store, exports, imports into an empty
store and compares episodes, citations, resources and policy; a tampered document
is rejected with a reason; an export never contains the pairing digest.

## T2.3-3 — Redaction preview

**Write scope:** `src/host/audit/preview.ts`, route, tests.

**Deliverable:** for a scope, the counts and labels the current policy would
exclude ("this is what we would not tell anyone"), computed by the same
predicates the ingestion path uses — not a second implementation.

**Acceptance:** a protected bundle id and a protected path prefix both show up as
excluded; an empty policy excludes nothing; the preview changes when the policy
changes.

## T2.3-4 — Timeline and episode detail

**Write scope:** panel (`src/client/index.ts`), `GET /timeline` if a grouped read
is cheaper than the client doing it.

**Deliverable:** day/week grouping, episode rows that open a detail view showing
resources, surfaces, citations, boundary reasons ("why was this recorded") and
the policy revision in force.

**Acceptance:** screenshot with the timeline rendered from real rows; a click
opens the detail and the captured interaction is recorded.

## T2.3-5 — Controls and the unanchored presentation

**Deliverable:** per-app allow/forget in one click from an episode, per-site
allow/deny for companion origins, retention controls, and an honest presentation
for episodes with no workspace: the resources and applications they did touch,
in place of the "Unanchored activity" label.

**Acceptance:** each control changes state in a captured interaction; an
unanchored episode shows its resources rather than a shrug.

## T2.3-6 — Documentation and the phase report

**Deliverable:** `docs/audit.md`, `docs/validation-phase2-3.md`, roadmap update,
`docs/verification-guide.md` gains the export round-trip recipe.

## Out of scope

Real-time streaming views, charts beyond day/week grouping, and any export
format other than the one this Host can re-import.
