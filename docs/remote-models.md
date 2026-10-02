# Remote models

A summary can be produced in three ways: **deterministic** (on by default, no
model at all), **local** (a model on this machine), and **remote** (a model
somewhere else). This document is about the third one, because it is the only one
where data leaves the machine.

The boundary is ADR 0010. The rule that existed before this phase — "nothing
leaves this machine" — is **false for any scope with a recorded remote opt-in**,
and every place that made that claim now says which of the two states it is in.

## What is sent

The minimised shape from `src/host/semantic/minimise.ts`, and nothing else:

```json
{
  "model": "…",
  "payload": {
    "appBundleIds": ["com.microsoft.VSCode"],
    "surfaceKinds": ["editor"],
    "resourceKinds": ["file"],
    "fileExtensions": ["ts"],
    "observationCount": 3,
    "startHourOfDay": 14,
    "durationMinutes": 25,
    "workspaceRootName": "demo",
    "hasThread": true
  },
  "observationIds": [1, 2, 3]
}
```

Not sent, ever: a full path, a URL, a window title, a document name, a file's
contents, a selection, or a query string.

**The preview is the send.** The panel's preview and the provider call one
function (`buildRemoteRequestBody`), and a test asserts that the bytes the fetch
received equal the preview body exactly, with the recorded digest being the
sha256 of those bytes. A preview built by a second code path would be a promise
instead of a property.

## Who may send

A scope (`workspace:<id>`, `app:<bundleId>`) may only send remotely when
`semantic_opt_ins` holds a `remote` row for it, written through the panel.
`assertRemoteOptIn` is the single gate, it is the **first** statement in the
provider, and `verify:semantic-boundary` proves that every file able to send
carries its required check.

## What cannot be undone

**Once a request has left, this Host cannot recall it.** What it does instead:

| | |
|---|---|
| audit | every send records endpoint host, model, time and payload digest in `remote_summary_sends` — no content, so the row can outlive the episode it was about (`ON DELETE SET NULL`) |
| revocation | deleting the opt-in deletes that scope's send records and reports how many were forgotten |
| retries | **none**. A failed call is reported, never repeated: a retry silently multiplies the copies that already left |
| default | off. A scope the user has not switched on produces no traffic, proven by a test with an injected fetch that records zero calls |

## Operating it

```bash
# who produces what, per scope
curl -sS -H "$C" "$BASE/semantic"

# the exact bytes a remote call would send for a scope
curl -sS -H "$C" "$BASE/semantic/remote-preview?scope=workspace:w1&model=…"

# switch a scope on, and off again
curl -sS -X POST -H "$C" -H 'content-type: application/json' \
  -d '{"scopeKey":"workspace:w1","providerKind":"remote","model":"…"}' "$BASE/semantic/opt-in"
curl -sS -X POST -H "$C" -H 'content-type: application/json' \
  -d '{"scopeKey":"workspace:w1"}' "$BASE/semantic/revoke"
# → {"revoked":true,"purged":0,"forgotten":1}
```

The endpoint is configured by the operator; it must be **https**, and a
plaintext endpoint is refused before any request is built.
