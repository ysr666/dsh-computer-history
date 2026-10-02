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
