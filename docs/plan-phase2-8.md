# Phase 2.8 — One editor companion for every editor

Status: Ready to execute (owner chose the self-declared identity, ADR 0011)
Boundary: ADR 0002 (metadata-only), 0007 (companion trust), 0009 (editor shape),
**0011 (self-declared identity)**, 0010 (remote models, untouched).

## Exit gate for 2.8

- `pnpm verify` and `pnpm verify:p1` green, with the new identity rules inside
  `pnpm verify` and each one calibrated red then green.
- A declared identity is validated, recorded as a **claim**, and the panel/audit
  shows the difference; a claim naming an application the user has not allowed
  stores nothing; a claim naming a protected application is dropped.
- The extension declares its own identity, so VS Code and Cursor need no Host
  change - proven by a live run on this machine's VS Code and by a test that
  feeds the payload Cursor would send.
- The wire format is documented so another editor can implement it
  (`docs/editor-companion.md`), including what a claim means.
- No behaviour change for anything else: the 307 tests that exist now still pass.

---

## T2.8-0 — spike: what each editor can say about itself

`vscode.env.appName` / `appHost` on VS Code (and Cursor, which is the same
extension host); what JetBrains exposes for a plugin (a different platform, so
the question is only what a JetBrains client *could* send). Output: the fields a
client should send and the ones it must not.

## T2.8-1 — the identity enters the protocol

**Write scope:** `src/host/companion/*`, `src/host/ingestion/*`, tests.

The `editor` shape gains `app: { bundleId, name }`; the observation carries it;
validation refuses a malformed claim; `policyAllows` decides as before; the
protected set wins over a claim.

**Acceptance:** a claim for an allowed application stores; a claim for an
unlisted application stores nothing; a claim naming a protected application is
dropped; a malformed claim is refused with a reason.

## T2.8-2 — the difference between observed and claimed

**Write scope:** the panel, `docs/audit.md`, tests.

The panel and the audit say which application identities came from the operating
system and which were declared by a companion. The redaction preview includes the
declared ones.

## T2.8-3 — the extension declares itself

**Write scope:** `extension-editor/`, tests.

The extension sends `vscode.env.appName`-derived identity instead of a hardcoded
bundle id, so the same package serves VS Code and Cursor.

**Acceptance:** unit tests for the identity mapping; a live run on this machine's
VS Code showing the declared identity in the stored row.

## T2.8-4 — the wire format, written down

`docs/editor-companion.md` documents the protocol precisely enough to implement
a client in another editor - the fields, the validation, what a claim means, and
what a client must never send - plus the phase report in
`docs/validation-phase2-8.md`.

## Out of scope

Writing a JetBrains plugin (the protocol makes it possible; the implementation is
its own phase), and any change to what may be sent.
