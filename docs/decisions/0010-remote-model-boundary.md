# ADR 0010: Remote model processing

Status: Accepted
Date: 2026-10-02
Accepted by: project owner ("继续" after the boundary and its cost were stated)

## Context

Phase 2.2 built the semantic layer so that a summary may only run **locally**:
`verify:semantic-boundary` fails if any file other than `local-provider.ts`
makes a network call, and it fails again if a file that could construct a remote
provider does not call `assertRemoteOptIn`. ADR 0004 wrote the rule: remote
requires a recorded per-scope opt-in, a payload preview, minimisation, citations
and a deletion contract. There is no remote provider yet, and this machine has no
local model runtime at all, so in practice the semantic layer has been inert.

This ADR turns that rule into an implementation. It is the first change in this
project that sends anything derived from the user's activity **off the machine**,
so the boundary comes first and the code follows.

## What may leave

The minimised shape that already exists (`src/host/semantic/minimise.ts`): the
application id, the surface kind, the resource **kind** and **file extension**,
observation counts, an hour bucket and a duration, and the workspace root's
**base name**. Never a full path, never a URL, never a window title, never a
document name, never a file's content or a selection.

The remote provider sends **that shape only**, and the payload preview shows the
operator the exact bytes before a scope is switched on.

## Who may trigger it

A scope (`workspace:<id>`, `app:<bundleId>`, …) may only send remotely when
`semantic_opt_ins` holds a `remote` row for it, written by the user through the
panel. `assertRemoteOptIn` is the single gate, the guard proves every potential
constructor calls it, and an unrecorded scope answers with an error rather than a
summary.

## Irreversibility, stated plainly

**Once a request has left, this Host cannot unsend it.** Everything below is a
contract about what we *do* control:

- the payload is minimised before it leaves, and the preview is exact;
- every remote summary records the endpoint, the model, the request time and a
  digest of the payload, so the user can see what was sent and when;
- revoking the opt-in deletes local remote summaries and their citations, and
  **says in the panel that the remote side cannot be recalled** — a deletion
  contract that pretends otherwise is worse than none;
- no automatic retry: a failed remote call is reported, not repeated. A retry
  silently multiplies copies that left the machine;
- remote processing is **off by default** and stays off for every scope the user
  has not switched on.

## Citations

A remote summary is valid only if it cites observations **from the payload it was
given**. A response citing an id outside that set is rejected, because a
citation the Host cannot check is worse than no summary at all (ADR 0004 §5).

## Consequences

- The phrase "nothing leaves this machine" in earlier documents becomes false for
  scopes with a recorded remote opt-in. Every place that makes that claim is
  updated in this phase, and the panel states per scope who produces the summary.
- A user who never enables a scope sees no behavioural change and no new network
  traffic; the guard keeps the default provable.
- Local providers remain preferred: `local` needs no consent, and a scope with
  both configured uses the local one unless the user chose otherwise.
