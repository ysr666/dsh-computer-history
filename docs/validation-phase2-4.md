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
