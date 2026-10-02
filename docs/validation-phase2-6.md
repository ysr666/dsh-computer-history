# Phase 2.6 runtime validation

Companion to `docs/plan-phase2-6.md`. Evidence first, per task.
Boundary: ADR 0010 (this phase), plus 0002, 0004, 0005, 0007, 0009 unchanged.

## T2.6-0 — spike

```text
src/host/semantic/provider.ts   SummaryProvider { kind, endpoint?, summarise(request) }
                                SummaryRequest { scope, payload, citations }
                                assertLoopbackEndpoint(endpoint)
src/host/semantic/opt-in.ts     assertRemoteOptIn(store, scope) → throws unless the
                                scope has a `remote` row
src/host/semantic/minimise.ts   minimiseEpisode → MinimisedSummaryPayload
                                (app ids, surface kinds, resource kinds, extensions,
                                 counts, hour bucket, duration, workspace basename)
```

The gate and the shape already existed; the missing piece was a provider that must
pass through the first and may only send the second.

## T2.6-1 — the remote provider

`src/host/semantic/remote-provider.ts` posts `{ model, payload, observationIds }`
to an operator-configured **https** endpoint, with no retry, a timeout, and a
response that must cite observations from the set this call sent.

```text
pnpm test tests/unit/remote-provider.spec.ts → 5 passed

no recorded opt-in        → throws, and the injected fetch recorded ZERO calls
a recorded remote opt-in  → one call; request body keys are exactly
                            [model, observationIds, payload]; payload equals the
                            minimised shape; the serialised body contains no
                            '/Users/', no 'http', no 'main.ts'
provenance                → endpointHost, model, sentAtMs and a sha256 digest are
                            reported for storage
citation outside the sent set → refused whole
no citations / http endpoint / 500 → refused; the http case performs no call at
                            all, and the 500 case records exactly ONE attempt
local-only opt-in         → throws with zero calls
```

The first and last cases are the ones that matter directionally: the opt-in check
is the first statement in the method, so a scope the user has not enabled cannot
cause traffic even by accident.

## T2.6-1 — the guard, and the hole it had

`verify:semantic-boundary` allowed network calls in **one** file
(`local-provider.ts`), so it correctly refused the new provider. The rule is now a
map of allowed senders, each with the check that belongs to it: the local provider
must call `assertLoopbackEndpoint`, the remote one `assertRemoteOptIn`, and any
third file may not send at all.

Writing it exposed a worse problem: **the guard could not see the new sender.**
The detector matched `\b(fetch|fetchImpl)\s*\(`, and the provider holds its
transport in `doFetch`, which has no word boundary before `fetch` - so the guard
reported "1 network call, all in local-provider.ts" while two files were sending.
Its own self-check ("no network call found in local-provider.ts: the detector no
longer recognises how requests are made, so this guard proves nothing") is what
made the next attempt visible rather than silently green.

```text
detector  /\b\w*[Ff]etch\w*\s*\(/   matches fetch, fetchImpl and doFetch
green     semantic boundary holds: 2 network call(s) in local-provider.ts and
          remote-provider.ts, each behind its own check
red       with the opt-in check removed from the provider:
            remote-provider.ts must check its endpoint with assertRemoteOptIn(
            remote-provider.ts: can build a remote provider without assertRemoteOptIn
green     check restored
```

`pnpm verify` → 300 tests, lint 0 warnings, adapters 11/22, store protection,
semantic boundary.

Still open in this phase: provenance storage (T2.6-2), the panel preview and the
irreversibility sentence (T2.6-3), revocation and deletion (T2.6-4), and
`docs/remote-models.md` (T2.6-5).
