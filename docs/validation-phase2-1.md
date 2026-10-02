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

## T2.1-1b — pairing routes

`GET /pairing` reports the pairing state plus whether the intake is listening
and on which port; `POST /pairing/rotate` issues a new token and returns it
once (the response is `no-store`, and only a digest is stored).

Live, against the running Host:

```text
GET  /pairing (unpaired)      {"paired":false,"listening":false}
POST /pairing/rotate          {"paired":true,"listening":false,"tokenChars":43}
POST /companion/observation   with token #1 → 201 {"stored":true}
POST /pairing/rotate          token #2 issued
POST with token #1            401 {"error":"pairing token required"}
POST with token #2            201 {"stored":true}
stored rows                   seq 1 and seq 3, provider companion
```

The absent seq 2 is the point: the rejected attempt stored nothing, and both
surviving rows carry companion provenance. That is the "token rotated" cell of
the privacy matrix, measured at the API level; T2.1-6 repeats it with the
extension in Chrome.

**A state that lied, caught by reading its own output:** the first run reported
`"listening":false` while the intake was accepting requests on 19388. The
optional `getCompanionState()` in the capture-controller interface had no
implementation, so the accessor silently fell back to the default. It exists now,
and `GET /pairing` and `/state.companion` both report the live listener.

## T2.1-4 — the MV3 extension

`extension/` holds a plain-ESM MV3 extension: `lib.js` (all the logic that can be
reasoned about without a browser), `service-worker.js` (Chrome event wiring
only), `options.html`/`options.js` (pairing UI), and a `lib.d.ts` that types the
contract for the tests while the implementation stays plain JavaScript because
Chrome loads it directly.

The privacy posture is in the manifest, not in a promise:

```json
{"incognito": "not_allowed", "permissions": ["tabs", "storage"],
 "host_permissions": ["http://127.0.0.1/*", "http://localhost/*"],
 "background": {"service_worker": "service-worker.js", "type": "module"}}
```

No content script, no page-content API, and only loopback host permissions. The
worker checks `tab.incognito` first and returns before reading anything else; it
reports `origin` and `path` only, because `normalizeUrl` drops the query string
and the fragment.

`pnpm build:extension` packages `dist/extension/` **and refuses** a manifest that
is not MV3, that allows incognito, that adds a content script, that asks for a
permission beyond `tabs`/`storage`, or that reaches a host other than loopback;
it also runs `node --check` on every script, because a syntax error in a service
worker otherwise appears only inside Chrome.

`pnpm test` → 240, six of them the extension's:

| case | expectation |
|---|---|
| incognito tab | never reported, payload not even built |
| `chrome://`, `chrome-extension://`, `file://`, `about:blank`, `devtools://`, garbage | not reportable |
| `https://example.test/docs/guide?token=secret#part-3` | `origin + /docs/guide`; the serialised payload does not contain `q=...` |
| empty title | omitted rather than sent as `""` |
| transport | posts to `127.0.0.1:<port>`, sends `x-companion-token`, returns the status |
| pairing check | `GET /companion/health` with the token, 200 ⇒ paired |

`GET /companion/health` was added to the intake for the options page's "Test
pairing", gated by the same token and storing nothing; it has its own test.

**Both new guards were calibrated in both directions:**

```text
lib.js + "document.body.textContent"   → verify:privacy fails, naming both tokens
manifest incognito: "spanning"         → build:extension fails: incognito must be "not_allowed"
restored                               → both pass
```

`pnpm typecheck` also caught what the tests could not: importing plain
JavaScript from a TypeScript test is `TS7016` until a declaration exists and
`TS2345` until the payload literal is typed as `false` rather than `boolean`.

## T2.1-6 — the privacy matrix on real Chrome

`scripts/verify/chrome-companion.mjs` (Chrome 154.0.8037.95, 2026-10-02):

```text
baseline companion rows for http://127.0.0.1:59514: 0
policy update: HTTP 200
extension id: kenfhlhnikhgfikedcgnifljhocfheng (loaded over CDP)
pairing written into the extension: {"companionPort":19388,"companionToken":"…"}
PASS  allowed origin stores rows: expected true, got true — 0 → 1
PASS  query string and fragment never stored — http://127.0.0.1:59514/allowed/page
PASS  stored path is the normalised one — http://127.0.0.1:59514/allowed/page
PASS  denied origin stores nothing — rows stayed 1
PASS  incognito stores nothing — rows stayed 1
PASS  rotated token stores nothing — rows stayed 1
PASS  extension disabled stores nothing — rows stayed 1
matrix: 7/7 cells pass
```

The first line is the evidence the other six rest on. Five "no new rows" cells
are worthless without a control that shows the same setup storing a row, and the
script now fails the whole matrix when the control fails — which is how the
three earlier attempts were caught, each of which had looked green while storing
nothing at all.

### Three obstacles that only appear when it actually runs

1. **Chrome 154 ignores `--load-extension`**, even with
   `--enable-unsafe-extension-debugging`. The extension is loaded over CDP with
   `Extensions.loadUnpacked`, which returns its id.
2. **Chrome ships built-in component extensions** whose targets also start with
   `chrome-extension://`. "The first extension target" was Google Hangouts, and
   its context has no `chrome.storage`, so pairing wrote nothing while the log
   said it had. Targets are now selected by the id `loadUnpacked` returned.
3. **An MV3 service worker sleeps.** The target to attach to exists only after
   the extension is woken, so the pairing step opens the options page first.

### What is still open

T2.1-5 (panel controls) is not done: the token rotation and the listening state
are reachable over the API and through the extension's options page, but the
panel itself does not yet show them or offer per-origin allow/deny shortcuts.
Recorded here rather than implied by the matrix being green.

## T2.1-5 — panel controls

The panel gained a **Browser companion** section: the listening state and port
(or the reason it is unavailable), a token button that creates or rotates the
pairing token, the token shown once with the sentence that says why, and an
origin field with *Allow site* / *Deny site* that writes a `resource` rule.

Measured in the real GUI (headless Chrome over CDP with the session cookie, the
plugin injected, 2026-10-02). The sidebar entry is `◷ Computer History` inside
the plugin menu; opening it renders:

```text
Browser companion | Listening on 127.0.0.1:19388 · not paired yet |
Create pairing token | Allow site | Deny site
```

Clicking *Create pairing token* answered with a 43-character token and the hint

```text
rVhI9jRIDmKtwFxO-Pi5PlCGsQbo5QuIeMvN_TbwqxY |
Copy this into the extension's options now — only a digest is stored, so it
cannot be shown again.
```

The screenshot is `/tmp/dsh-panel-21.png` (reviewed): the sidebar highlights
*Computer History*, the header reads `Capture: running · Accessibility: granted
· Raw retention: 24h`, and the companion box sits above the existing
pause/delete/refresh controls with the origin field and both site buttons.

Three attempts failed before this one, which is worth recording because each
failure looked like a rendering bug and was not:

1. clicking any element whose text contained "Computer History" hit a chat
   message in the conversation behind the sidebar;
2. `#/main/computer-history`, `?panel=computer-history` and `#computer-history`
   are not routes the shell answers;
3. the clickable control is the `BUTTON[aria-label="插件"]` two levels above the
   `sidebar.panellist` slot, and the panel entry only exists *after* that menu is
   opened — so the successful sequence is two clicks, not one.
