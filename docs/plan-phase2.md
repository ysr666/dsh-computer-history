# Phase 2 Plan — Daily-driver alpha (metadata-only)

Status: Draft for user approval
Date: 2026-10-02
Owner: DSH session `session-afe69e7c`

## Goal

Phase 1 proved the pipeline runs in a real Host and answers "where was I".
Phase 2 should make it something a user keeps switched on:

1. cover the places work actually happens (browser, more editors/terminals),
2. make an Episode say **what the work was**, not only which resources were
   touched,
3. make the whole thing controllable and auditable from the client,
4. and harden the store itself (at-rest protection, threat model).

The metadata-only boundary (ADR 0002) is **not** reopened: no clicks, no
keystrokes, no screenshots, no document bodies, no text values.

## Non-goals

- Click/keystroke/screenshot/content capture.
- Windows and Linux collectors.
- Always-on background *remote* model processing (local-only summaries are in
  scope, see ADR 0004).
- Browser page content, DOM, or selected text.

## Workstreams

### W2 — Adapter coverage and resource quality (start here)

Goal: every supported surface produces a resource-accurate Episode.

- New adapters: JetBrains family, Xcode, Notes, Obsidian, Word/WPS.
- Fix the quality gaps Phase 1 validation exposed:
  - VS Code workspace attribution is not stable (`seq 2` had no workspace even
    though the file was open);
  - Cursor 3.x `Cursor Agents` window exposes an empty `kAXDocument`, so the
    active file is invisible;
  - observations without a resource or workspace ("Unanchored activity")
    should aggregate by application/surface instead of fragmenting.
- Deliverables: adapter contract tests, a per-adapter resource-outcome table
  in the docs, an unanchored-rate metric.

Acceptance: ≥8 adapters with contract tests; a scripted 30-minute work session
yields resource attribution for every file/URL-based surface and an unanchored
rate reported as a number (target: below the Phase 1 baseline, no regression).

### W5 — At-rest protection and threat model

Goal: the store is not the weakest link.

- Encrypt history at rest (SQLCipher or an encrypted container) or document a
  keyed design in `SECURITY.md`; key material in the Keychain.
- Update `SECURITY.md` with the threat model Phase 1 validation implied:
  infostealer reading the DB, backup/Time Machine copies, plugin directory
  permissions, and what an attacker learns from observations vs episodes.
- Deliverable: `docs/threat-model.md`, a "what is on disk" section, and a test
  that fails when the store is created unencrypted.

Acceptance: a fresh store is encrypted (or the design is recorded and tested);
`SECURITY.md` names the assets, the attacker, and the mitigations.

### W1 — Browser companion (Chrome MV3)

Goal: cover the main work surface without weakening the boundary.

- Extension reports the active tab's URL, title, window/space, and the
  browser's own private/incognito state; **incognito never reports**.
- Site-level allow/deny lists; no DOM, no page body, no selected text.
- URL normalisation into `resource kind=url`; provenance
  `source.provider=companion`; merged into the same Episode stream.
- Deliverables: extension, host-side companion intake, privacy test matrix.

Acceptance: incognito, denied sites, and PDF/devtools focus produce zero rows
(test matrix green); an allowed site produces an Episode whose resource is the
normalised URL; the roadmap's "browser deferred" clause is retired with this
evidence.

### W3 — Semantic layer, Work Threads, Resume

Goal: turn provenance into understanding (see ADR 0004 for the boundary).

- Local-first semantic summaries with citations to observation ids; remote
  summarisation only as a per-scope opt-in with payload minimisation.
- Work Thread intelligence: link Episodes across application switches using
  the existing `threadKey` scaffolding.
- Make the experimental ResumeHint usable: "where did I stop", with provenance
  and a one-action reopen; still off unless the caller asks.

Acceptance: the existing resume benchmark improves over the deterministic
baseline with the number recorded; every summary cites observation ids; a
network-egress check proves the local path sends nothing; resume hints remain
opt-in.

### W4 — P2 UI, control, and audit

Goal: the user can see, explain, and revoke everything.

- Timeline (day/week), Episode detail with "why was this recorded", per-app and
  per-site controls, retention controls.
- Export/audit: "what do you know about me" → a JSON export that can be
  re-imported, plus a redaction preview.
- Close the Phase 1 findings: the protected-path title-only residue (F13), the
  `Unanchored activity` presentation, and the allow/forget flow.

Acceptance: visual and interaction evidence for the timeline and controls
(screenshot + click → state change, as used in Phase 1 validation); export
round-trips; F13 closed or explicitly re-decided.

## Sequencing

| Step | Content | Exit gate |
|---|---|---|
| 2.0 | W2 + W5 (quality and trust base) | adapter contract tests + encrypted store + threat model |
| 2.1 | W1 browser companion | privacy test matrix green, incognito zero-rows |
| 2.2 | W3 semantic/threads/resume | local-path egress check + cited summaries + benchmark number |
| 2.3 | W4 UI/audit | timeline + export evidence, F13 closed |

Each step ends with the Phase 1 discipline: `pnpm verify` green, forward
commits only, a validation report under `docs/`, and the environment returned
to its pre-test state.

## Verification method (carry Phase 1 lessons forward)

- Synthetic fixtures only; never real private files or credentials.
- Two-sided calibration for every probe (known-held vs known-free), because
  Phase 1 produced three false alarms from uncalibrated probes.
- Cross-session comparisons must partition by `collector_session` before
  calling anything a leak.
- Prefer a same-input differential (one variable changed) over an absolute
  measurement.
- Frontmost-app tests need an idle-gated activation helper, not a focus fight.

## Risks

| Risk | Mitigation |
|---|---|
| Companion widens the privacy surface | incognito and deny are fail-closed; test matrix gates the step |
| Remote summaries leak titles/paths | ADR 0004: local-first, per-scope opt-in, minimised payload, citations |
| Encryption makes the store unreadable after key loss | document recovery in SECURITY.md; keep the export path |
| Adapter sprawl multiplies maintenance | contract tests + a shared adapter trait, not per-app code paths |
| ResumeHint grows into autonomous action | stays opt-in, bounded, and instructs the agent to reopen sources |
