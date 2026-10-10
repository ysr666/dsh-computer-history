# v1.1 upgrade preflight and rollback plan

Status: **Read-only preflight available; no user-profile migration approved or performed.**

The latest v1.1 feature chain (M1–M7) uses UI and Host contracts measured on
DSH `0.2.0-rc.2` and `0.2.1-alpha.2`. **These are specifically tested
builds, not an assertion that all 0.2.x versions are compatible.**

## Current owner-machine finding (2026-10-10)

The inspected everyday `desktop` profile on macOS uses:

- DSH CLI `0.1.2-rc.1`, which does not provide the tested v1.1 UI-slot APIs.
- Computer History `0.1.0-dev.0`, installed from a local
  `file:` tarball dependency rather than the reviewed v1.1 release.
- An existing `history.sqlite` together with `history.sqlite-wal` and
  `history.sqlite-shm`, and a collector ownership lock.
- Other plugins installed in the same profile, whose coexistence with a new
  DSH runtime has not been acceptance-tested.

These are **read-only structural observations**. The private history rows,
saved notes, browser captures, linked accounts and user settings were not
read or uploaded. No normal DSH process was stopped, no profile updated, no
live database checkpointed or migrated.

## Safe operator command

From the DCH repository, on the computer you intend to upgrade:

```bash
pnpm preflight:upgrade -- --profile desktop
# Or a machine-readable inventory (no user history row content):
node scripts/preflight-local-upgrade.mjs --profile desktop --json
```

This script reads only the profile/package manifest and the presence/size of
history files; it does not open SQLite or read its content. It asks the
installed `dsh --version` for version information.

- Exit **2** means one or more structural blockers, not a failed application
  installation.
- Exit **0** means no structural blockers were observed, **not** that an
  upgrade was approved or all other plugins are compatible.
- Exit **1** means invalid arguments or a preflight error.
- The script never performs an installation, backup, update, process kill,
  migration, database repair, or release.

Using another local home/profile for a disposable rehearsal:

```bash
node scripts/preflight-local-upgrade.mjs \
  --dsh-home /absolute/path/to/temporary-dsh-home \
  --profile e2e --json
```

## Actual upgrade sequence — only after explicit user approval

1. Choose the exact tested target DSH build and signed, immutable DCH
   release artifact. Review the release CI on that exact SHA.
2. On a **separate DSH_HOME and profile**, install the target versions and
   confirm first-run, History/Privacy, Work Memory, Continue, editor/browser
   companions, and interactions with critical third-party bundles.
3. Agree on downtime and retention. Stop the original DSH Host and
   collectors, then confirm the database is no longer actively being written.
4. Make a **consistent SQLite backup**, using SQLite's backup API (or an
   equivalent verified transactional snapshot). If WAL/SHM exists, copying
   `history.sqlite` alone is **not** adequate. Preserve matching profile
   manifests, package locks, companion configuration and provenance of the
   installed package.
5. Verify the copied database with `PRAGMA integrity_check` and a
   **disposable restore**, and record the pre-upgrade schema version. Treat
   backups as personal sensitive data and keep them local/protected.
6. Rehearse migration **only on the disposable copy** first, including the
   new browser-title cleanup migration 0015, M1–M7 reads, retention and
   explicit note-grant boundary. Confirm the backup is still restorable.
7. With a confirmed backup and an approved downtime window, explicitly
   authorize the production CLI/profile/plugin upgrade and any migration.
   Do **not** overwrite the old `file:` tarball in place.
8. Validate the real installed client and a representative, user-approved
   historical project. Check that confidential browser query data does not
   appear in titles or summaries, and that no Skill or automation is
   silently created.

## Rollback is a **restore**, not a schema downgrade

If the new Host has applied a schema migration, the old development plugin
must **not** reopen the newer database and assume backward compatibility.

Stop the new Host, then restore together:
- the original compatible DSH CLI and old plugin/profile manifests;
- the *consistent pre-migration SQLite snapshot*, not just an outdated
  `history.sqlite` copied while WAL was active;
- matching locally backed-up companion setup as necessary.

Revalidate the restored old environment before resuming capture. There is
currently no tested reverse migration for schema 0015 or all subsequent
M1–M7 migrations.

## Release/acceptance distinction

The v1.1 feature chain and browser-title hotfix are merged into GitHub
`main`, with real macOS isolated packaged checks and GitHub cross-platform
CI. That is **not** proof that the owner's old `desktop` profile has been
upgraded or that populated multi-project M6/M7 suggestions are useful.
Release tagging/npm publishing and user-profile deployment require separate
explicit approval.
