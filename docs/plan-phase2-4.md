# Phase 2.4 — Integrity and guard hardening

Status: Ready to execute (2.3 closed 2026-10-02)
Boundary: ADRs 0002, 0004, 0005, 0007, 0008 unchanged.

Phase 2 is complete as planned (2.0–2.3). Before any new feature, this phase
closes the two things Phase 2.3 left open about *the code we already ship*: a
class of bug the test suite cannot see, and a live observation nobody explained.

## Exit gate for 2.4

- The duplicate-route class fails **in the test suite**, not only at runtime, and
  the guard is calibrated both ways (it goes red for a real duplicate and green
  once fixed).
- The invariant "a summary never loses its citations except through a recorded
  deletion" is asserted by a test that can fail, and the live observation that
  contradicted it is either reproduced and fixed or explained with evidence.
- `pnpm verify` and `pnpm verify:p1` green; every task keeps its own section in
  `docs/validation-phase2-4.md`; environment restored per task.

---

## T2.4-1 — the guard that could not fail

`tests/unit/host-api.spec.ts` compares the registered paths against a **stub**
registry that never rejects a duplicate. When `/retention` was registered twice,
the stub stayed green and the real registry threw during setup, taking the whole
plugin fiber down; the only reason it was found is that the live reload reported
`failed` and the error text was dug out of `fiber._error`.

Root fix, not a pipeline: the guard must exercise the same rule the real registry
enforces — one registration per (path, method set) — against the real
`connection.fetch.register` surface, or the plugin's own registration function
must reject a duplicate path before the registry does. Whichever, the test has to
be able to go red.

**Acceptance:** a deliberate duplicate makes the suite fail with a message naming
the path; removing it makes the suite pass; no new production concept is
introduced beyond what the registry already enforces.

## T2.4-2 — the invariant about citations

Live observation from T2.3-5: a seeded episode ended up with
`episode_summary_citations = 0` and `episode_surfaces = 0` while
`episode_observations = 2`, its observations intact, and **no** deletion log
entry. The ingest path was cleared by test (`tests/integration/rebuild-isolation.spec.ts`),
so what remains is the periodic work: the retention sweep and the repair path,
meeting an episode whose resource cannot be canonicalised (the seed used a
`file:///tmp/...` URI whose file never existed, and macOS makes `/tmp` a
symlink).

Write the invariant as a test first, then reproduce: after a sweep and after a
reseed, for every episode, every citation must still point at an observation the
episode still links, and a summary must not lose citations without a recorded
deletion. If the reproduction fails to show a loss, the explanation is the
deliverable — with the evidence that distinguishes "cannot happen" from "did not
happen this time".

## T2.4-3 — live re-run with a resource that is real

The earlier live seeds wrote states the ingestion path would never produce. With
a real file on disk (the recipe that finally worked in 2.3), run the plugin long
enough for its timers to fire and watch the derived rows across several sweeps:
they must not change except by an expiry that was stamped at insert time.

**Acceptance:** a timestamped log of the rows across at least two sweep periods,
and either no change or a change with a recorded cause.

## T2.4-4 — documentation and the phase report

`docs/validation-phase2-4.md` (per-task evidence), the roadmap gains the phase,
and `docs/audit.md`'s "known gap" note is updated to say how the gap was closed.

## Out of scope

New features (editor companion, Windows/Linux collectors, remote model
processing), which stay owner decisions, and any change to the privacy boundary.
