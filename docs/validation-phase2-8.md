# Phase 2.8 validation

Companion to `docs/plan-phase2-8.md`. Evidence first, per task. The 307 tests that
existed when the phase started must still pass.

## T2.8-0 — spike (folded into T2.8-1)

The three products this has to serve: VS Code and Cursor are the same extension
host (a VS Code extension runs in both; the product name differs), and JetBrains is
a different plugin platform that can speak the same wire format. So the protocol
carries an identity the client declares, and the Host stops hardcoding one.

## T2.8-1 — the identity enters the protocol

`CompanionPayload`'s editor shape gains `app: { bundleId, name }`. The Host
validates the shape and treats it as a **claim**: the observation keeps
`source.provider === 'companion'`, the allow-list decides as before, and the
protected set wins over a claim.

```text
pnpm test tests/unit/companion-intake.spec.ts tests/unit/companion-observation.spec.ts
  → 19 passed
pnpm test tests/integration/companion-workspace.spec.ts → 6 passed
```

| case | result |
|---|---|
| a claim is accepted and carried through | stored, identity preserved |
| five malformed claims (empty id, whitespace, blank name, extra field, bare string) | each refused with 400 |
| an editor payload with no identity | refused: "app is required for an editor payload" |
| **a claim the user has not allowed** | stores nothing - `ingest` returns false, store count 0 |
| **a claim naming a protected application, even when allowed** | dropped - the built-in list wins |
| an allowed claim | stored, with the claimed id **and** `source.provider === 'companion'` |

The last three are the ones the phase's boundary rests on: declaring an identity
is not declaring access, and it is recorded as a claim rather than as an
observation the operating system made.

**One of my own mistakes, again the same shape:** a replacement in the intake spec
silently did nothing - the helper I meant to edit has different indentation than
the pattern I matched - so two tests failed for a reason unrelated to the change.
The report keeps it because it is the third time this session that an unasserted
edit looked like success.
