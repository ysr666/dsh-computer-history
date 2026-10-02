# ADR 0003: Collector control acknowledgements

Status: Accepted
Date: 2026-10-02

## Context

Phase 1 treats capture policy and pause state as privacy boundaries, not UI hints.
A Host therefore must not infer that a native control command succeeded merely
because it was written to the helper's stdin.

The original protocol acknowledged pause/resume through native state messages,
but policy configuration had no corresponding acknowledgement. That left a
version-skew and decode-failure gap in which the Host could resume a helper
without proof that the intended policy revision had been applied.

## Decision

Collector control is fail-closed and acknowledgement-driven.

- `hello` is the first collector message.
- `pause` resolves only after native reports `state=paused`.
- `resume` resolves only after native reports `state=running`.
- `configure` carries a non-negative policy revision.
- Native emits `configured { revision }` only after applying that revision.
- A running policy transition is:
  `pause ack -> configure -> matching configured ack -> resume ack`.
- Missing, unexpected, or mismatched acknowledgements are protocol failures.
- Control acknowledgement timeout stops the helper and relinquishes ownership.
- Phase 1 native policy mode is wire-level `include-only`; other modes are
  rejected before application.

A user-requested paused state survives recoverable helper restarts. On restart,
the Host restores pause before applying policy, so a new helper cannot collect
between handshake and policy initialization.

## Ownership consequence

The cross-process capture lock is the authority for ambient capture ownership.
A Host that already owns it may borrow a process-local policy lease. Releasing
capture ownership waits for all such leases to drain. This prevents helper
failure or Host teardown from transferring ownership while the old owner is
still committing or propagating a policy mutation.

## Reconciliation consequence
The native helper performs a five-second reconciliation heartbeat for foreground
application, Accessibility trust, and observer attachment. The heartbeat is not
an activity sampling loop: a semantic fingerprint suppresses unchanged metadata,
so no periodic observation is emitted solely because time passed.

Pause detaches Accessibility observers before its acknowledgement. Sleep also
detaches observers; wake reconciles the current foreground application.

A durable Work Episode sleep boundary is intentionally not synthesized from
transient process state. If Phase 1 later requires replay-stable sleep boundaries,
that requires an explicit persisted protocol/schema event and a separate ADR.

## Consequences

The protocol is slightly more explicit, but every privacy-sensitive control
transition now has observable completion semantics. Host restarts, helper
restarts, policy mutation, and multi-Host ownership can be reasoned about as
state transitions rather than best-effort writes.
