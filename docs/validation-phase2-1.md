# Phase 2.1 runtime validation

Companion to `docs/plan-phase2-1.md`. One section per task, evidence first:
the command that produced the result, then the result. Environment restored
after every section (throwaway Chrome profile removed, listeners closed,
temporary extension state deleted).

Boundary in force: ADR 0002 (metadata-only), ADR 0007 (companion trust
boundary), ADR 0004 (semantic enrichment).

## Plan review — the three assumptions the design rests on

Checked before writing any extension code, because each one would have
invalidated the plan rather than a line of it:

| Assumption | Check | Result |
|---|---|---|
| The plugin process can open its own loopback listener (ADR 0007 relies on it, since the DSH API cannot be reused) | staged tool inside the running DSH host: `http.createServer` on `127.0.0.1:0`, then a real `fetch` against it | **holds** — `{"listening":true,"address":"127.0.0.1","port":56530,"fetchResult":{"ok":true,"token":"spike-token"}}`, listener closed after the probe |
| The DSH webserver really rejects an unauthenticated call to the plugin's routes (which is why the intake cannot live there) | `curl http://127.0.0.1:19387/api/computer-history/state` with no cookie | **holds** — `HTTP 401 unauthorized` |
| A real Chrome is available for the matrix and the default port is free | `Google Chrome --version`; bind `127.0.0.1:19388` | **holds** — Chrome 154.0.8037.95, port 19388 free |

The first check also decided the port strategy: the intake binds an ephemeral
port only in tests, and the shipped default is 19388 with the port shown in the
panel when it cannot bind.

## T2.1-0 — intake feasibility spike

Done as the plan review above; the remaining work is packaging: the listener
lives in `src/host/companion/intake.ts` and is started/stopped with the plugin.

## T2.1-1 — pairing token

Migration 0002 adds `companion_pairing` (single row, `CHECK (id = 1)`) holding a
SHA-256 digest and a timestamp. `CompanionTokenStore.rotate()` returns the token
exactly once, `verify()` compares digests in constant time, and `state()` never
exposes the digest.

`pnpm test` → 219 tests, four of them new:

- absent before pairing; only the issued token verifies; a one-character
  extension, a truncation and an empty string all fail;
- the stored value is a 64-hex digest that does not contain the token
  (`expect(row.token_hash).not.toContain(token)`), which is the "shown once"
  promise in ADR 0007 turned into a test;
- rotation invalidates the previous token;
- the pairing survives closing and reopening the store.

Adding the migration made two existing guards fail, both of which hardcoded a
migration count:

```text
database.spec.ts            expected [...] to have a length of 1 but got 2
migration-upgrade.spec.ts   expected { count: 2 } to deeply equal { count: 1 }
```

They now derive the expected count from `latestSchemaVersion()`, so the next
migration does not need them edited, and the frozen-v1 upgrade fixture still
proves that an existing database reaches the new schema without losing history.

## T2.1-3 — provenance-gated URL resources

The rule moved from "URL resources are dropped" to "URL resources are dropped
unless the observation came from the paired companion". The provider is now
first-class end to end instead of a constant:

- `NativeObservation.source.provider` is optional and the wire parser never sets
  it, so anything decoded from the collector is `macos-ax` by construction;
- `ActivityObservation.source.provider` is `'macos-ax' | 'companion'`;
- `resourceOf` strips the query string and the fragment from an `http(s)` URL,
  because the extension is not the only thing that must not store a token in a
  URL: a buggy or compromised companion must not be able to either;
- the browser adapter (`companion.browser`, surface kind `browser`) is the
  synthetic source; no real application carries that bundle id, so the
  Accessibility path cannot produce one.

**A second copied constant surfaced while wiring this:** the store's read path
hardcoded `provider: 'macos-ax'` instead of reading `source_provider`, so a
companion row would have read back as an Accessibility observation. It now reads
the column through a validator, the same shape as the adapter fix in 2.0.

Tests (`pnpm test` → 221):

- an Accessibility observation whose window carries
  `https://example.test/private?token=abc` is dropped and stores nothing;
- a companion observation of
  `https://example.test/docs/guide?token=secret#section-3` is stored with
  `canonicalUri = https://example.test/docs/guide`, the display label from the
  title, `source.provider = 'companion'`, and the stored URI contains neither
  `secret` nor the fragment.

## T2.1-2a — companion intake (transport)

`src/host/companion/intake.ts` implements the listener ADR 0007 describes:
loopback bind (ephemeral in tests, `19388` by default), `POST
/companion/observation` only, pairing-token check, a body cap, a per-token rate
limit, and an incognito refusal host-side as well as in the extension.

`pnpm test` → 231, ten of them for the intake:

| case | result |
|---|---|
| paired observation | `201 {stored:true}`, payload delivered |
| missing token, wrong token | `401`, nothing delivered |
| incognito payload | `403`, nothing delivered |
| body over the cap | `413`, nothing delivered |
| third request with `rateLimitPerMinute: 2` | `429`, and delivery stopped at two |
| malformed JSON, origin with a path, `seq: 0` | `400` with a reason, nothing delivered |
| `Host: evil.test` (DNS rebinding) | `403`, nothing delivered |
| wrong path | `404`, nothing delivered |
| `stop()` then a request | connection refused — the port is really released |
| second intake on a taken port | rejects with "port … is already in use" |

Two defects were caught by running the checks rather than reading them:

- the 413 path destroyed the socket before writing the response, so the client
  saw a "socket hang up" instead of a status it could act on; the response is
  now written first and the connection closed after;
- the intake declared both a private `port` field and a public `port` getter.
  `pnpm test` passed because vitest strips types; `pnpm typecheck` failed with
  `TS2300 Duplicate identifier 'port'`. Same lesson as the branded id in 2.0:
  the gate is the typecheck, not the test runner.

**Remaining for T2.1-2:** wiring — start the listener with the plugin, stop it
on dispose, refuse delivery while capture is paused, and surface
"companion unavailable" in `/state`. Recorded here so the gap is visible rather
than implied.

## T2.1-2b — plugin wiring, verified live

The intake is started with the plugin (stoppable through `ctx.effect`), the
state surfaces through `/state.companion`, and delivery is refused unless the
plugin owns capture and the helper reports `running` — pause means nothing new
is recorded, for the companion exactly as for the Accessibility collector.

Measured on the real Host (plugin injected into a one-time data directory,
`pnpm build` + `dev_reload_package` first):

```text
GET /state            {"listening":true,"port":19388,"paired":false}   capture: running
lsof -iTCP:19388      DeepSeek 18729 … TCP 127.0.0.1:19388 (LISTEN)     loopback only
pragma user_version   2      (migration 0002 applied, companion_pairing exists)
POST (paired, ?token=secret#frag)   201 {"stored":true}
POST (no token)                     401
POST (incognito: true)              403 {"error":"incognito tabs are never reported"}
POST (while paused)                 202 {"stored":false}
stored row           companion.browser | Example page | provider companion | adapter browser
stored resource      url | https://example.test/docs/guide | label "Example page"
after unload         port 19388 free (the listener is closed with the plugin)
```

The stored URI is the acceptance for two rules at once: the query string and the
fragment are gone, and the URL only exists because the observation carried
companion provenance.

**The stale-module trap recurred.** The first live attempt showed
`companion: undefined`, no listener, and no `companion_pairing` table — the
running instance predated the build, exactly as in the 2.0 fragmentation
verification. `dev_reload_package` fixed it, and the checks that exposed it
(`/state`, `lsof`, `pragma user_version`) are now part of the recipe rather than
something to remember. A live measurement after a build is only meaningful
after the reload.
