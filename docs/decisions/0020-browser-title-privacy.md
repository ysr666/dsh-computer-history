# ADR 0020 — Privacy-first browser titles at the Host boundary

Status: Review candidate
Date: 2026-10-10

## Product acceptance finding

An isolated installed-product run on macOS with the CI-built
`dsh-computer-history-1.0.1.tgz` and DSH `0.2.1-alpha.2` passed the
55-step browser/editor/Continue lifecycle but exposed a privacy defect:
the browser's canonical resource URL removed the query string and fragment,
yet a page title echoing `?token=...` remained in the Work Thread display
label and its summary.

The browser title is a free-form value supplied by a web page (and can itself
contain a signed URL). Cleaning the URL alone does not guarantee that the
saved metadata remains free of that secret.

## Fix at ingress, not a UI-only mask

For accepted HTTP(S) resources, the Host now:

1. strips the query string and fragment,
2. clears URL username/password,
3. derives a resource display label from the sanitized host and pathname,
   **never** from a browser-provided page title, and
4. never saves a browser surface/window title, including from a companion
   whose supplied resource is URL-shaped.

This is intentionally stricter than displaying arbitrary site page titles:
the product remains useful through site/domain/path and application identity,
without retaining untrusted title text. Other editors and file-oriented apps
retain their previous window-title and file-label behavior.

## Upgrade of existing stores

Migration **0015** operates inside the normal transactional schema migration:

- clears persisted labels of URL resources;
- nulls historical browser window titles;
- re-derives summaries for affected Episodes from retained resource identities
  and app bundle IDs, with a deterministic summary kind.
- preserves Episode IDs, citations, times, thread keys, raw observation rows
  (other than browser window titles), user-confirmed notes, and policy rules.

Old model-generated summaries of affected browser Episodes are replaced with
safe deterministic summaries. That may reduce their descriptive detail; the
privacy guarantee is preferred over preserving a free-form title that might
contain authentication material.

The migration also identifies affected browser surfaces when their original
raw observations have expired. It never assumes a page title is harmless just
because the URL resource was query-stripped.

This migration does **not** scrub externally exported backups already created
from older builds. Anyone restoring such backups must use the normal migration
flow or consider the backup as sensitive.

## Regression and release gate

- Host ingestion test supplies both a URL with user-info/query/fragment and a
  page title echoing query data. Persisted observation and resource metadata
  must contain neither secret.
- Upgrade regression starts from a simulated actual version-14 store, seeds a
  historical browser URL/title/summary leak, migrates, and checks raw columns,
  projected Episode, provenance, and idempotent reopening.
- Old JSON audit backups are a separate untrusted ingress route: the import
  strips URL user-info/query/fragment, rejects unsupported URL schemes,
  never restores URL labels or browser observation titles, and replaces only
  **newly imported** browser-linked Episode summaries with safe deterministic
  summaries. Reimporting the same backup cannot bring back legacy titles.
- The real packaged Chrome product journey now asserts both its Episode
  payload and reader panel never display the query-token substring.

No data in the user's real default history store was read, rewritten, or
migrated during acceptance. Release and live migration remain separate
explicit deployment/acceptance steps.
