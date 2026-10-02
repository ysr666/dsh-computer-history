# Phase 2.6 — Remote model processing

Status: Ready to execute (owner approved the boundary after it was stated)
Boundary: ADR 0002 (metadata-only), 0004 (semantic layer), 0005 (store
protection), 0007 (companion), 0009 (editor companion), **0010 (this phase)**.

## Exit gate for 2.6

- `pnpm verify` and `pnpm verify:p1` green, with the remote guard's calibration
  inside `pnpm verify`: no non-loopback request without a recorded opt-in, and a
  deliberate violation of that rule turns the guard **red**.
- The minimised payload is asserted byte-for-byte in a test: no path, no URL, no
  title, no file name beyond an extension.
- A remote summary that cites an observation outside its payload is rejected.
- Revoking a remote opt-in deletes local remote summaries and their citations,
  and the panel states that the remote side cannot be recalled.
- `docs/remote-models.md` and `docs/validation-phase2-6.md`; ADR 0010 recorded.

---

## T2.6-0 — spike: what exists and what is missing

Read `src/host/semantic/{provider,minimise,local-provider,opt-in}.ts` and
`scripts/verify-semantic-boundary.mjs`. Establish precisely: which shapes are
already minimised, what `assertRemoteOptIn` checks, how the guard finds potential
constructors, and what a remote provider must implement to satisfy both.

## T2.6-1 — the remote provider

**Write scope:** `src/host/semantic/remote-provider.ts`, tests.

A `RemoteSummaryProvider` that posts the minimised payload to an
operator-configured https endpoint, with no automatic retry, a timeout, and a
response schema that requires citations. Refuses without a recorded opt-in.

**Acceptance:** with no opt-in it throws a specific error and performs **no**
network call (asserted with an injected fetch, both ways); with an opt-in the
request body equals the minimised payload exactly; a response with a citation
outside the payload is rejected; a non-https or non-configured endpoint is
refused.

## T2.6-2 — provenance for what left

**Write scope:** `src/host/store/migrations/0007-remote-summary-provenance.ts`,
`src/host/semantic/*`, tests.

Each remote summary records endpoint host, model, request time and a payload
digest, so the audit can answer "what was sent, where, when". The digest is of
the payload the Host actually sent.

## T2.6-3 — preview and the panel

**Write scope:** the panel, `GET /semantic/preview?scope=…&provider=remote`.

The preview returns the exact bytes a remote call would send, and the panel shows
them with the irreversibility sentence from ADR 0010 next to the switch.

## T2.6-4 — revocation and deletion

Revoking a remote opt-in deletes local remote summaries, their provenance rows
and their citations; the panel and `docs/remote-models.md` say that the remote
side cannot be recalled.

## T2.6-5 — guard calibration and documentation

Extend `scripts/verify-semantic-boundary.mjs` so the remote constructor is
covered, calibrate it red (temporarily construct a remote provider without the
opt-in check) and green, and write `docs/remote-models.md` plus the phase report.

## Out of scope

Windows/Linux collectors, and any change to what is stored locally.
