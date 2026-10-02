# ADR 0005: Store protection at rest

Status: Accepted
Date: 2026-10-02

## Context

The Computer History store is a plaintext SQLite database. During the Phase 1
runtime validation both stores examined were `0600` inside a `0700` directory,
and `SECURITY.md` already stated that protection against recovered disk blocks
"depends on full-disk encryption such as FileVault". What was missing was a
decision, an enforcement check, and an honest statement of what the store does
and does not protect.

Measured on the validation machine (2026-10-02):

- `fdesetup status` → `FileVault is On.`
- store directory `0700`, `history.sqlite` and its WAL `0600`
- search is a substring `LIKE` over `summary_text`, `primary_workspace_id`,
  `primary_workspace_title`, `canonical_uri` and `display_label`

## Options

1. **SQLCipher or an encrypted database binding.** Strongest single control. It
   means replacing `node:sqlite` with a native encrypted build across the whole
   store, a toolchain and packaging change outside Phase 2.0's trust base.
2. **Field-level encryption of the revealing columns** (window title, canonical
   URI, workspace root, display label, element identifier) with a Keychain key.
   It preserves the schema but breaks the `LIKE` search the panel and the agent
   tools use; recovering search needs a searchable-index design (keyed
   blind indexes for exact match, which cannot serve substring search).
3. **Depend on full-volume encryption and restrict the store to it**, with
   enforcement: file permissions, a FileVault assertion, and a guard that the
   store never lives in a synced or network location.

## Decision

Option 3, enforced by `scripts/verify-store-protection.mjs` and part of
`pnpm verify`:

- the data directory must be `0700` (or stricter) and every file in it `0600`
  (or stricter) — the store already creates them that way, so this is a
  regression guard, not a new behaviour;
- the resolved store path must not sit inside a synced or network location
  (iCloud Drive, Dropbox, OneDrive, Google Drive, `/Volumes/**`), because a
  synced copy leaves the encrypted volume and a network volume has no
  at-rest guarantee;
- on macOS, `fdesetup status` must report that FileVault is on.

Options 1 and 2 are recorded as the follow-ups that a changed threat model
would require (a store outside the user's home directory, a synced store, or a
requirement to resist an attacker inside the user's own session).

## Consequences

- The store's confidentiality inside a running session equals the user's own
  access. A process running as the user, or a malicious DSH plugin, can read
  the database. File permissions and FileVault do not address that, and the
  threat model says so explicitly.
- What the store contains is limited by ADR 0002: identifiers and timing, never
  content. That is the mitigation that still holds when everything else is
  bypassed.
- A future decision to encrypt columns must come with a search design, and the
  checks in `verify-store-protection.mjs` will then have to change with it.
