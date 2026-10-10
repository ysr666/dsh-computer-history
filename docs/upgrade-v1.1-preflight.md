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


## Additional gate for the unmerged AI-first History candidate

The published/mainline v1.1 M1–M7 inventory above is **not** the same thing
as the separate AI-first candidate patch. That patch adds a new SQLite
migration **0016** (Episode-retained save/build/test activity facts), evidence
query APIs, and a source-checked AI-to-Continue bridge. Migration 0016 is
forward-only and must NOT be applied to the original owner's desktop SQLite
until the candidate is reviewed, signed/released, backed up and explicitly
authorized.

The read-only CLI preflight cannot detect or validate SQLite schema version:
by design it never opens the database. A report with zero structural
blockers means only that the manifest/WAL/SHM/profile inventory found none.
Before approving this candidate, rehearse **0015 -> 0016** only against a
fresh disposable database or consistent, separately authorized backup,
including:
- Surviving linked raw observations backfill into v16 Episode facts;
- Expired raw data without Episode-retained evidence is never invented;
- Episode deletion / forget cascades to its materialized facts;
- Export/import recomputes aggregates only from actual imported linked raw
  observations, never trusting supplied aggregate counts;
- A backup containing only compacted Episode facts cannot reconstruct those
  facts on import without linked raw evidence;
- Downgrade is a database **restore**, not running an older DCH plugin against
  a newer SQLite schema.

The independent, capture-disabled QA `desktop` profile with DSH
`0.2.0-rc.2` passed the **read-only inventory** on 2026-10-10:
zero structural blockers, three cautions. This is **not** acceptance of a
production migration, or proof that a populated multi-project user history
will retain useful coverage. Production profile contents were not opened.


## Fourteenth-pass synthetic WAL backup and restore rehearsal (2026-10-10)

The automated integration test `tests/integration/synthetic-upgrade-rehearsal.spec.ts`
now verifies the *backup-and-restore procedure*, not just migration 0016 itself.
It generates a private temporary SQLite database with the v15 schema
(equivalent to v15 by dropping migration-0016 tables and its version record
in a **new synthetic-only** v16 database), creates a WAL with linked CAD-save
and test-success activity, and deliberately removes the raw observation for
one expired Episode. The original v15 database remains open during SQLite's
**online backup API** operation, and a subsequent source write demonstrates
that the backup is a point-in-time snapshot.

Only the restored temporary copy is opened by the candidate Host and upgraded:
- SQLite `integrity_check` reports `ok` and `foreign_key_check` has no rows;
- one provable save and one provable test result are retained;
- an Episode whose raw save was already deleted gets no invented save fact;
- the source v15 database remains at version 15;
- deliberately tampered migration checksums are rejected before upgrading;
- a separate clean pre-migration backup restores successfully afterward.

The temporary backup file is permission-restricted to `0600` in the test.
Test files are deleted from the temporary directory; no user history or
production DSH files are opened, transmitted or migrated. **Limit:** This
is a generated v15-schema rehearsal, not a real archived v15 installation or
a backup of an actual populated user profile. It also does not validate
backup performance with a very large history, cross-platform ACL protection,
or concurrent real collectors. The remaining production migration gate is
unchanged: stop writers, obtain explicit authorization, back up user data
consistently, verify a disposable restore, and only then consider an upgrade.


### Fifteenth-pass migration atomicity check (synthetic)

A new test creates a deliberately conflicting table in a disposable v15
SQLite database. Migration 0016 first creates episode_saved_resources
but then fails while attempting to create the already-present
episode_verification_results. The migration runner rolls back the entire
transaction: the version remains 15, no version-16 migration log row survives,
and the first newly created table is absent. After removing the synthetic
conflict, re-opening upgrades successfully and both fact tables contain
only verifiable events. The test does not open or repair real history stores.
