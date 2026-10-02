# Phase 2.4 runtime validation

Companion to `docs/plan-phase2-4.md`. One section per task, evidence first: the
command that produced the result, then the result. Environment restored after
every section. Boundaries: ADRs 0002, 0004, 0005, 0007, 0008 unchanged.

## T2.4-1 — the guard that could not fail

`tests/unit/host-api.spec.ts` collected registered paths from a fake registry
whose `register()` did `routes.set(route.path, route)`. A second registration for
the same path silently replaced the first, so the guard could never fail — which
is why the duplicate `/retention` registration in 2.3 sailed through it and only
surfaced when the real registry threw during setup and took the plugin fiber
down.

The fix is in the fake, not in a new mechanism: it now enforces the rule the real
registry enforces, with the same message.

```text
red   a top-level second registration of /state
      → Tests  7 failed (7)
      → Error: connection: exact Fetch route "/api/computer-history/state"
        is already registered
green the duplicate removed
      → Tests  7 passed (7)
```

Both directions were run; the red probe is a real duplicate at the top level of
`registerHistoryApi`, not inside a handler.

One false start worth recording: the first red probe injected the duplicate
**before a line inside the `/timeline` handler body** instead of in the
registration flow. The suite stayed green and I nearly read that as "the guard
still cannot fail" — it was the probe that never ran. The second probe put the
duplicate where registrations actually happen, and the guard failed as it should.

## T2.4-2 — a summary could lose its evidence with nothing recording it

The live observation from 2.3 was that an episode ended up with
`episode_summary_citations = 0` while `episode_observations` and the observations
themselves were intact and `deletion_log` was empty. Reading the only writer of
that table found the mechanism, and it is a defect rather than a mystery:

```ts
      commit()                       // ← the episode's links and aggregates are now durable
      // Citations are replaced wholesale …
      this.db.prepare('DELETE FROM episode_summary_citations WHERE episode_id = ?')
      const cite = this.db.prepare('INSERT OR IGNORE INTO episode_summary_citations …')
```

The citation rewrite sat **after** the commit, inside the `try`, so a failure
there could not roll back what had already been written: links committed,
citations deleted, nothing re-inserted, no deletion record, and the `catch`
block's `ROLLBACK` a no-op on an already-committed transaction. That is exactly
the signature observed on the real machine.

**The test was written to fail before the fix, and it did:**

```text
red    expect(episodes.get(id)?.summaryObservationIds).toEqual([firstObservation])
       → AssertionError: expected [] to deeply equal [ 1 ]
       (the citation rewrite was pointed at an observation that does not exist,
        so it threw - and the links written earlier stayed committed)
green  after moving the rewrite inside the transaction, before commit()
       → tests/integration/episode-store.spec.ts  9 passed
       the failed call now leaves the episode exactly as it was: one link, one
       citation, aggregates unchanged
```

`pnpm verify` → 281 tests, lint 0 warnings, every guard green.

**What this does and does not explain.** It explains the citations: any failure in
that block, including a crash between the two writes, produced precisely the state
seen live, and it can no longer. It does **not** yet explain why
`episode_surfaces` was empty at the same time: on the full-replace path the
surfaces are rewritten inside the transaction and re-derived from the links by
`reconcileAggregates`, so a committed link set should have left surfaces behind.
That half is carried into T2.4-3, whose long run watches the derived rows across
several sweeps - and the report will not claim it closed until it is.
