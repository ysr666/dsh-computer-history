# DCH AI-first v1.1 — candidate release gates and packaging audit

**Audit date:** 2026-10-10. **Status:** NOT READY TO PUBLISH.
All observations below are from the isolated candidate source at
`/tmp/dch-v11-ai-first/repo` and newly created synthetic/packaging artifacts.
Do not apply this patch to the owner's dirty, 41-commit-behind worktree.

## Confirmed code and engineering gates

- 923 source tests were green, with 2 skipped (previous sixteenth pass).
- The synthetic Find → Answer → Continue path, bounded History-only tool
  exposure, source-level save/resource correlation and migration 0016
  rehearsal had independent automated verification.
- An isolated DSH 0.2.0-rc.2 Web Host displayed the real plugin UI and error
  path; the independent QA Electron executable started successfully.
- **NOT** confirmed: permitted end-user actions in the native Electron UI,
  live model completion with fully synthetic data, or a real-user migration.
- The candidate patch applied cleanly to verified main at 71b53631. Recheck
  main before preparing a PR: these results are time-specific.

## Packaging audit: deliberately incomplete no-script package

Run only in an isolated build output directory:

```shell
npm pack --ignore-scripts --pack-destination /tmp/dch-v11-ai-first/release-artifacts-QA --json
DSH_RELEASE_TARBALL=/tmp/dch-v11-ai-first/release-artifacts-QA/dsh-computer-history-1.0.1.tgz node scripts/verify-release.mjs
```

The tarball contains 25 files and weighs about 236 KiB compressed. It includes
`lib/index.js`, `lib/client.js`, `lib/client.d.ts`, both locale files and
the brand icon. It **does not contain** any of the three platform-specific
Collectors, `bin/native-artifacts.json`, the browser extension, or the
VS Code VSIX. The release verifier correctly exits **1** and explicitly names
those missing files.

**Interpretation:** this is expected when skipping `prepack`, NOT proof
that the official CI release assembler is broken. It is a **negative test
showing incomplete local artifacts are rejected**. The resulting tarball is
not suitable for installation, sharing or release.

## Release workflow audit and fix

The existing `.github/workflows/release.yml` previously read
`package.json` but also required the literal version `1.0.1`. That
would block any v1.1 release even after an authorized version bump.

The separate, already-open Draft PR #167 removes that stale constant while retaining:
- a non-empty package version;
- `RELEASE_TAG = v<VERSION>`;
- the exact target `GITHUB_SHA`;
- matching `main` and immutable existing-tag commitments;
- published release documentation, README announcements, registry checks,
  CI results and the full product-journey/release preflight.

`tests/unit/release-workflow-version.spec.ts` guards against reintroducing
the literal pin. The existing `verify-ci-boundaries.mjs` remains green.

## Release pipeline (read-only analysis)

`.github/workflows/release.yml` has three separate native build jobs,
one each on macOS, Windows and Linux. The assembler downloads all of them,
checks their source SHA, records native hashes/provenance, and sets
`DSH_NATIVE_PREBUILT=1` for the final `pnpm pack` so that the Mac runner
does not replace cross-platform output. The verifier requires all three
binary files and their provenance. This is the intended release pathway,
not a local `npm pack --ignore-scripts`.

## OPEN blocking items (do not mark as passed)

1. **Native Electron QA interaction:** actual rendered History + Settings,
   keyboard and click flow, error recovery, user-confirmed Continue, with
   authorized isolated profile. A previous automation attempt was blocked by
   the execution safety checker; do not work around that refusal.
2. **Live-model synthetic Find → Answer → Continue:** only within an explicit
   authorized, credential-free or separately authorized synthetic setup;
   must not load personal credential stores, personal History, or generic
   shell/filesystem tools. Existing fixture-model tests do not meet this gate.
3. **Release-assembled package:** obtain three-platform CI-native artifacts
   and genuine VSIX/browser extension; `verify:release` and packaged
   client/product-journey checks must pass against the actual tarball.
4. **Release identity:** candidate `package.json` still says `1.0.1`.
   Do not update it or try publishing until the owner authorizes the release
   version. On release cut, update package version, `CHANGELOG.md`,
   `docs/releases/v<version>.md`, bilingual README announcements and
   verify the registry namespace/state.
5. **Migration:** test a consistent restore from an explicitly authorized
   real old-profile backup after stopping collectors, not from a live profile.
   No production SQLite migration or raw-history upload has occurred.
6. **Merge path:** the source worktree is dirty/behind remote. Create a clean,
   independent PR branch from latest main when authorized; review the candidate
   patch without altering the original directory. No commit/push/PR/release
   has been performed in this round.

No file in this audit is a release authorization. The proper next step is
*controlled candidate PR review* and completing the two remaining runtime
gates, not publishing to npm.
