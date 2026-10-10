# v1.1 pre-release installed-product acceptance

Date: 2026-10-10
Status: **Acceptance executed in an isolated environment; not a public release or a live-user-profile upgrade.**

## Environments are not equivalent

- **User's everyday Mac:** DSH CLI `0.1.2-rc.1`; active `desktop` profile's Computer History plugin `0.1.0-dev.0`. This is **not** the current v1.1 product and must not be treated as an accepted deployment.
- **GitHub main before this hotfix:** Computer History package `1.0.1`, code with M1–M7 and compatibility CI against DSH `0.2.1-alpha.2`.
- **Isolated macOS product trial:** DSH CLI and Web `0.2.1-alpha.2`, genuine packaged Computer History `1.0.1`, real Google Chrome, installed Browser/Editor companions, and a throwaway SQLite history store.

The isolated CLI was installed under `/tmp/dch-v11-acceptance-20261010/`, **not** on the user's normal PATH. The original local worktree, original DSH profiles, and existing history database were not modified.

## Evidence

Initial CI-built package run passed **55 product journey assertions** across installation, first-run consent, Chrome pairing and browser privacy matrix, trusted editor save/verification signals, Episode composition, Continue capsule and exact session binding, disable/re-enable behavior, and uninstall preserving history.

Actual reader UI exposed a release-blocking issue: a free-form browser page title that echoed URL query parameters was included in the Work Thread resource label even though the canonical URL had already been cleaned. Screenshot-based inspection confirmed the mismatch.

After the Host privacy fix and migration, the repaired package passed **59 installed-product assertions**, adding:

- browser title and Episode payload do not expose the deliberately sensitive URL query/fragment fixture;
- M1 Work Memory can expand and list its retained project in the real DSH interface;
- M6 Suggested Skills and M7 Suggested Automations render correctly for a one-Episode project, including truthful **insufficient-evidence** states.

Both installed-product runs used actual Chrome/DSH/plugin package lifecycle instead of a fake React component environment; activity provenance came from an isolated real Host/SQLite instance. The repaired-product test was performed against macOS; other-platform packaged gates remain the responsibility of the pull-request CI.

## Separate data safety checks

- Browser URL credentials, query, fragment and free-form page titles are dropped at the Host ingress boundary.
- A new transactional migration (15) removes previously stored title labels and restores browser-linked Episode summaries from safe structural metadata, without deleting existing trusted thread assignments or user-confirmed notes.
- Older URL identities that collide after redaction are merged with Episode links and counts retained.
- Importing a historic JSON backup independently applies URL/title redaction and rederives **only newly imported** browser-linked Episode summaries. Reimporting the same backup cannot reintroduce titles.

Historical exports produced by older builds can still **contain** sensitive information: users should treat any existing JSON backups as sensitive, and restored data must pass through the new import/migration boundary.

## Known release gates

This work does **not** establish readiness of the user's old everyday DSH 0.1.x profile; new plugin client slots require a supported DSH 0.2.1 alpha or newer compatible environment.

After this fix merges, the following are still separately required before publishing:
- cross-platform GitHub CI, including packaged macOS/Windows/Linux product checks;
- explicit release and versioning decision;
- owner-approved upgrade path for the existing local `desktop` profile and database backup/rollback;
- a human review of real populated M1–M7 views and recommendation usefulness over more than one short Episode.

No real user profile was updated and no release was published during this acceptance.
