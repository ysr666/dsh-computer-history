# Release: install, upgrade, roll back

This document states what has been **measured**. Where a step has not been
verified, it says so rather than describing the intention.

> [!IMPORTANT]
> **First public pre-release target: `v0.1.0-alpha.1` — not published yet, and packaged for macOS only.**
>
> Windows and Linux collectors have source/live evidence, but the current release workflow does not build or
> merge their native binaries into the plugin tarball. A three-platform packaged release therefore remains a
> separate distribution task; alpha.1 must not claim it.
>
> The packaged Host path has been measured successfully, the public repository and brand
> surface are in place, and the release workflow is ready to build a tagged artifact.
> The remaining product blocker is the **client half of an installed bundle**: the Host API
> starts, but the installed bundle's panel has not yet been observed in the interface.
> Do not create the tag until that path is verified and the release preflight is green.

## v0.1.0-alpha.1 readiness

| Gate | Status |
|---|---|
| Public repository, security reporting, issue/PR templates | ✅ |
| Timeline Orbit brand assets and social-preview asset | ✅ |
| Package icon and localized plugin metadata included in the tarball | ✅ |
| Host plugin install from a packed tarball | ✅ |
| macOS native/package build gate | ✅ |
| Shared collector protocol checks on macOS / Windows / Linux | ✅ |
| macOS collector included in the packaged artifact | ✅ |
| Windows/Linux collectors included in the packaged artifact | ➖ not in alpha.1; separate distribution task |
| Installed bundle's **client panel** appears and works | ⬜ blocker |
| `pnpm verify:release:blockers` at release cut | ⬜ run at release cut |
| Non-`-dev` package version + matching changelog section | ⬜ set only when cutting the release |


## What ships

| artifact | command | status |
|---|---|---|
| plugin tarball | `pnpm pack:plugin` → `dsh-computer-history-<version>.tgz` | builds; contents verified byte-identical to the working tree |
| editor extension | `pnpm build:editor-extension` → `dsh-computer-history-editor.vsix` | installed and started on VS Code 1.140.0 (`docs/editor-companion.md`) |
| browser extension | `pnpm build:extension` → unpacked MV3 directory | installed and exercised on Chrome 154 (`docs/companion.md`) |

## Installing the plugin: the verified path

From a checkout, with the profile's junction pointing at the repository:

```bash
pnpm build
ln -sfn "$PWD" ~/.dsh/profiles/<profile>/node_modules/dsh-computer-history
# then load the entry (the plugin manager, or the loader API)
```

Verified: the entry reaches `[active]`. Every phase's runtime evidence was
produced on this path.

## Installing from the tarball: Host path verified; client panel still open

```bash
npm pack                                        # dsh-computer-history-<version>.tgz
dsh plugin --profile <profile> add ./dsh-computer-history-<version>.tgz
# then list the package in the profile's package.json "bundles" and start the Host
#   the CLI normally does this itself for a package it installs for the first time; it does not repair a
#   package that was already in `dependencies` (an earlier failed attempt). Skipping it is silent: the log
#   says `pending (waiting for services: connection, workspaceRegistry)` and the Host never listens
#   (docs/development.md has the measurement)
```

Verified on this machine, with the result that came back:

```text
install        Packages: +1, done in 705ms (pnpm, through the plugin entry)
profile        dependencies: { "dsh-computer-history": "file:.../dsh-computer-history-0.1.0-dev.0.tgz" }
               bundles: [ "dsh-computer-history" ]
after restart  GET /api/computer-history/state → { "enabled": true, ... }
               firstRunPreset present: true
```

What made it work is a field this package did not have: **`dsh.bundle.patch`** pointing at its
own `cordis.patch.yml`, which declares the plugin's entry. Without it the package could be
mounted **by hand** - which is how every measurement in the earlier phases was taken - but not
**installed**: a profile that added it as a bundle got nothing at all.

Three approaches recorded as measured failures, so nobody repeats them:

- **a symlink from the profile into the checkout**: the loader does not accept a realpath
  outside the profile (the same wall the vision-router hit), so the plugin simply does not load;
- **a hand-copied directory** in the profile's `node_modules` with `dependencies` and `bundles`
  set: still nothing - the profile has to be installed through its own package manager, which is
  what `dsh plugin --profile <profile> add` does;
- **a profile copied into a temporary `DSH_HOME`**: its bundles and `file:` dependencies do not
  resolve there at all.

**Still open, and stated as such:** the **client half** of an installed bundle does not appear in
the interface on this Host yet, so the install is verified for the host plugin and *not* for the
panel. Until that is fixed, this document says so rather than claiming a complete install.

## Publishing

Do not publish `v0.1.0-alpha.1` until the readiness table above has no product blocker.
The version/changelog/tag changes are intentionally deferred until that point so a public
branch cannot accidentally look release-ready before the installed client path is proven.

Push a tag named `v` + the version in `package.json` (`.github/workflows/release.yml`). The workflow runs the
same gate as `main`, builds the collector, packs, runs `pnpm verify:release`, and creates the GitHub release with
the tarball attached and the changelog section as the notes. **It needs no certificate and no secrets.**

### Why no certificate: a plugin install is not an app install

Measured on an arm64 Mac with the collector this repository ships (2026-10-05):

| what was measured | result |
|---|---|
| an **unsigned** arm64 binary | killed by the kernel (`Killed: 9`) - so a signature **is** required |
| the **ad-hoc** signature this build produces | runs; it is what makes the binary executable at all |
| a copy with a **Safari quarantine flag** | **ran normally** |
| what `curl`/Node downloads carry | no quarantine attribute at all |
| `spctl -a -vvv` on the ad-hoc binary | "rejected" - and it runs, because that gate is for app bundles |
| how this ships | `dsh plugin add` fetches the tarball with Node and the plugin spawns the collector as a child |

So the hard requirement is "signed at all", which `scripts/build-native.mjs` already satisfies, and `spctl` is
not the check for this artifact. `pnpm verify:release` therefore requires a signature that verifies
(`codesign --verify --strict`) and reports which kind it is, instead of demanding a Developer ID.

### When a Developer ID certificate would become necessary

Only if the product ships a `.app`, `.dmg` or `.pkg`, or tells a user to launch the binary from Finder - that is
where Gatekeeper's notarization rule applies. Then: a paid Apple Developer account, a **Developer ID
Application** certificate exported as a `.p12`, `--options runtime`, `xcrun notarytool submit --wait`, and (for
a bundle, not a bare binary) `xcrun stapler staple`. None of that is needed for a DSH plugin today.

### The scan that runs before it

`pnpm verify:release:blockers` (its own step in the workflow) fails on two things only: a failed run on `main` in
the last twenty, and an open **high or critical** dependabot alert. Open pull requests and issues, how many
branches have a commit from the last month, and whether the alerts could be read at all are reported but not
enforced - whether they block *this* release is a judgement, and a script that pretends otherwise gets ignored.

### Running it locally

```bash
pnpm native:build                    # ad-hoc; the log says which signature it made
pnpm pack --pack-destination /tmp
DSH_RELEASE_TARBALL=/tmp/dsh-computer-history-<version>.tgz pnpm verify:release
```

Measured 2026-10-05 with the version still at `0.1.0-dev.0`: `pnpm verify:release` exits 1 and names what is
actually missing - the `-dev` version and the absent changelog section - while the signature check passes.
The release workflow itself has not run yet: it needs a tag, which is the owner's call.
