# Threat model

Scope: the local Computer History store, the collector helper, and the Host
plugin that owns capture. Read with `SECURITY.md` (collection boundary) and
ADR 0002 (metadata-only), ADR 0004 (semantic enrichment) and ADR 0005
(at-rest protection).

## Assets

| Asset | Lifetime | Contents |
|---|---|---|
| Observations | 24h raw TTL | application identity, resource URI (file/URL), window title, element role/identifier, timing, privacy state |
| Episodes | 30d | deterministic summary text, workspace, resource and surface summaries, observation ids |
| Resources | with episodes | canonical URI plus display label |
| Policy | until changed | mode, allow/deny/protect rules, revisions |
| Deletion log | 24h | scope, range/bundle, counts, timestamp |
| Ownership lock | per capture session | holder pid, in the data directory |

Never stored, in any form: keystrokes, clicks, screenshots, audio, clipboard,
document bodies, page bodies, selected text, Accessibility text values,
terminal buffers (ADR 0002).

## Adversaries and what they get

| Adversary | Reach | What they learn | Mitigation in force |
|---|---|---|---|
| Process running as the user (infostealer, malicious script) | reads anything the user can read | the whole store: which apps and files were used, when | none beyond ADR 0002: the store holds no content, so the loss is a work timeline, not documents. `secure_delete` + VACUUM are best-effort against recovery of deleted rows |
| Malicious DSH plugin in the same profile | Host API as the user, can load code | the whole store, and can change policy | none cryptographic; the plugin ecosystem is trusted by the user, and the panel exposes what exists so the damage is visible in the data itself |
| Another local user | filesystem | nothing (store is `0700`/`0600`); if they gain the volume, see below | file permissions enforced at creation and checked by `verify:store-protection` |
| Device theft, powered off | the disk | nothing readable | FileVault, asserted by `verify:store-protection` |
| Backup, Time Machine, or a sync client | copies the store off the volume | the whole store, possibly in plaintext on another device | the store must not live in a synced location; `verify:store-protection` fails on iCloud Drive, Dropbox, OneDrive, Google Drive and `/Volumes/**`. Time Machine copies are outside the project's control and are covered by FileVault only while the volume is encrypted at rest |
| Hostile or buggy helper | the stdio protocol | could try to inject protected metadata | the Host re-screens every metadata field independently, validates the protocol and policy revisions, and fails closed on missing/mismatched acknowledgements |
| A secure field on screen while capture runs | the AX surface | could be recorded as an ordinary window | three-valued secure detection that fails closed, per-field screening, and a library-level test that an unreadable element records nothing |
| Someone with the store after the user deleted history | the DB and its WAL | deleted evidence | deletion rebuilds or removes derived episodes, short-lived tombstones block delayed pre-deletion observations, and WAL checkpoint/VACUUM run best-effort. Not a forensic guarantee |

## Residual risks (accepted, with reasons)

- **Plaintext inside an unlocked volume.** A session-local attacker reads
  everything. ADR 0005 records the two encryption options that would change
  this, and why neither is in Phase 2.0 (a native encrypted binding; a
  searchable-index design for column encryption).
- **Titles are descriptive text.** A window title can carry a client name or a
  document name; it is metadata, and the project treats it as sensitive but
  does not redact it, because a redacted title loses the product's value. The
  protected-path and secure-field screens are the boundary, not title content
  (F13, the protected-path title residue, is tracked in T2.0-4/W4).
- **FileVault is the only at-rest control.** If it is off, the check fails
  loudly rather than degrading silently; the operator can still read the
  failure and decide.
- **Sync-location detection is textual.** A path that reaches iCloud through a
  symlink or a differently named mount is not detected; the check covers the
  documented locations rather than every possible one.

## Enforcement map

| Claim | Enforced by |
|---|---|
| No content-bearing APIs in the collector | `pnpm verify:privacy` (symbol denylist over `src`, `native`, `scripts`) |
| Adapters have measured evidence | `pnpm verify:adapters` |
| Store permissions, non-synced location, FileVault | `pnpm verify:store-protection` (ADR 0005) |
| Secure fields never become metadata | native privacy tests (`pnpm native:test`), fixture recipes in `docs/verification-guide.md` |
| Deletion cannot survive in summaries | `tests/integration/deletion.spec.ts`, `final-hardening.spec.ts` |
| One capture owner per data directory | `tests/unit/capture-lock.spec.ts`, `tests/unit/collector-hardening.spec.ts` |
| Retention bounds | retention sweep tests and the sweep in `src/host/plugin.ts` |
