# The collector protocol

One contract, three collectors. macOS implements it in Swift today; Windows (UI Automation) and Linux
(AT-SPI2) will implement the same messages, and the conformance suite (`pnpm verify:collector`) is what
decides whether they may. This document is the contract, written from the types in
`src/shared/protocol.ts` and the parsers in `src/host/collector/protocol.ts`.

## Transport

Newline-delimited JSON over the collector's stdout; the host writes commands to the collector's stdin.
One object per line. A line that is not JSON is a protocol error - the host raises it rather than
skipping it, because a collector whose output cannot be read is a collector whose silence means nothing.

Every message carries `v: 1` and a `type`.

## Collector to host

| type | when | required fields |
|---|---|---|
| `hello` | once, first | `collectorSession`, `collectorVersion`, `platform`, `arch`, `capabilities` |
| `observation` | when the tracked state changes | see below |
| `state` | when the collector's own state changes | `state`, `accessibilityTrusted` |
| `configured` | once per accepted configuration | `revision` |
| `diagnostic` | any time | `level`, `code`, `message` |
| `fatal` | when it cannot continue | `code`, `message` |

`platform` is `darwin` in the type today; a Windows or Linux collector adds its own value, which is a
change to this table rather than a licence to send something else.

### `observation`

```jsonc
{
  "v": 1, "type": "observation",
  "collectorSession": "…", "seq": 7, "observedAtMs": 1791011759552,
  "app": { "pid": 1, "bundleId": "com.microsoft.VSCode", "name": "Code" },
  "window": { "title": "provider.ts", "document": "file:///…/provider.ts", "url": null },
  "element": { "role": "AXTextArea", "subrole": null, "identifier": null },
  "activity": { "idleSeconds": 0 },
  "privacy": { "secure": false, "protected": false },
  "workspace": { "root": "/Users/you/Projects/demo" },
  "source": { "adapter": "vscode" }
}
```

`seq` increases within a `collectorSession`; repeats of `(collectorSession, seq)` are dropped as
duplicates. `observedAtMs` is the host's clock domain - a collector must not send times in the future.

**`workspace` is honoured only from a companion** (`source.provider === 'companion'`, ADR 0009). The
wire parser never sets `provider`, so an observation decoded from a collector is `macos-ax`, and a
collector that sends `workspace` does not get it trusted.

## Host to collector

| type | meaning |
|---|---|
| `configure` | the policy (include-only) and the revision to acknowledge |
| `pause` / `resume` | stop and start emitting observations |
| `shutdown` | exit cleanly |

Acknowledgement is not optional: the host treats a missing, mismatched, unexpected or timed-out
`configured` as a failure and stops the collector, because "the policy may not have arrived" is not a
state capture is allowed to run in.

## What must never appear

This is the boundary (ADR 0002), and it is a requirement on the *shape*, not on discipline:

- no field may carry screen or window contents, a screenshot, or a recording;
- no field may carry document text, a selection, a clipboard, a keystroke or a mouse coordinate;
- no field may carry a terminal buffer, a shell history, or a browser page body;
- **unknown fields are refused, not ignored** - so adding one is a protocol error rather than a
  harmless extra - which is what makes this list enforceable by a parser instead of by review;
- a `protected` or `secure` observation is dropped before storage, and the refusal is counted by reason.

## Timing, as implemented and measured

- **Heartbeat: 5 seconds** (`Collector.swift`). It reconciles the foreground application, the
  Accessibility trust state and the observer attachment. **It does not re-emit unchanged metadata**: an
  observation is deduplicated by a fingerprint, so sitting in one file produces one observation rather
  than one per heartbeat. That is why a duration can read as `0 ms` for a single sample, and why the
  interface says "under a minute" instead of a precise figure (see
  `docs/validation-three-platforms.md`).
- **Sleep detaches observation; wake reconciles before capture resumes** (`state` carries the reason).
- **Quiet period: 480 seconds** closes an open episode (`src/host/episodes/builder.ts`).

## What the conformance suite will check

1. **Protocol**: the collector starts, emits `hello` first, answers `configure` with a matching
   `configured`, emits observations that validate against the shape above, and exits cleanly on
   `shutdown`.
2. **Boundary**: an observation carrying an unknown field is refused; a protected application is dropped
   with its reason; a secure field withholds the observation; the policy decides what is stored.
3. **Fixtures**: recorded platform event streams (AX, UIA, AT-SPI) that each collector must turn into
   **the same observations, field by field**.

**Not verified yet:** the suite does not exist. Everything above marked "measured" was measured on
macOS; the message table is a reading of the types and parsers, and the conformance suite - not this
document - is what will make it checkable.
