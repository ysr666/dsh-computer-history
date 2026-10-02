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

### A commit carried a broken guard, and that is the lesson

The previous commit contained a guard script that **did not parse**: my edit that
reworded the summary line left a stray `)`,`, and `node --check` would have caught
it in one second. The gate printed `Node.js v24.5.0` and `Found 0 warnings and 2
errors`, and the commit went in anyway because the message-building step ran
before the gate result was read.

Two things are worth writing down rather than smoothing over:

- the fix is a forward commit that repairs the file, not an amend, so the broken
  state stays visible in the history;
- the guard's own self-check is what would have caught this class if it had been
  the *detector* that broke - here it was plain syntax, and nothing in the
  pipeline substitutes for reading the gate result before committing.

## T2.6-2 — the record of what left the machine

Migration 0007 adds `remote_summary_sends`: episode id, scope key, endpoint host,
model, payload digest, time. **No content** - not the payload, not the summary,
not a path - which is what lets the row outlive the episode it was about.

The two deletions this phase promised pull in opposite directions, and the schema
says which is which:

- deleting an **episode** is about content, so the link goes and the audit fact
  stays: `episode_id` is `ON DELETE SET NULL`;
- revoking an **opt-in** is an instruction to forget, so the rows go outright
  (`deleteForScope`).

```text
pnpm test tests/integration/remote-send-store.spec.ts → 3 passed

a send round-trips, and PRAGMA table_info lists exactly the seven columns -
  there is no column a payload or a summary could occupy
deleting the episode keeps "something left for this scope" and drops the link
revoking one scope forgets that scope and leaves the other untouched
```

Still open: the provenance sink is not yet wired into a summary flow, because
there is no panel switch that produces a remote summary until T2.6-3. The store
and its schema are the part this task promised.

## T2.6-3 — the preview is the send, byte for byte

The promise "the preview shows what would be sent" is only worth making if the
two cannot drift, so both call **one function**:
`buildRemoteRequestBody({ model, payload, observationIds })`. The provider no
longer builds its own body; the backend preview calls the same one.

```text
backend   semanticsRemotePreview({scopeKey, model}) → { payload, body }
provider  summarise() → fetch(…, { body: buildRemoteRequestBody(…) })

pnpm test tests/integration/semantic-remote-flow.spec.ts → 2 passed

the bytes the injected fetch received EQUAL the preview body, and the recorded
  payloadDigest is the sha256 of exactly those bytes
without an opt-in: no call at all and no row recorded
```

Alongside it, `LocalBackend.summariseRemotely` wires the provenance sink: the
provider's `onSent` record is written to `remote_summary_sends` together with the
scope and the episode, so the audit can answer "what left, where, when" from the
store rather than from the network layer.

Two mistakes of mine surfaced while wiring it - a duplicate `parseScopeKey`
import and a missing `ObservationId` type - both caught by `pnpm typecheck`
within a minute, which is the argument for running it before the tests rather
than after.

Still open in T2.6-3: the panel itself. The switch that turns a scope remote, the
preview text, and ADR 0010's irreversibility sentence belong with T2.6-4's
revocation, because the two sentences - "this will leave" and "this cannot be
recalled" - have to sit next to each other to mean anything.
