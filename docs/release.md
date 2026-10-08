# Release: install, upgrade, roll back

This document states what has been **measured**. Where a step has not been
verified, it says so rather than describing the intention.

> [!IMPORTANT]
> **First public pre-release target: `v0.1.0-alpha.1` — not published yet, and intentionally one three-platform artifact.**
>
> The packaged collector path is now measured end-to-end on macOS, Windows and Linux. Each native collector is
> built on its own runner from the same commit, all three exact binaries are assembled into one plugin tarball
> with SHA-256 provenance, and that same tarball clean-installs on all three runners without a
> `collectorExecutable` override.
>
> The installed **client/panel product path is now measured on all three platforms** as well: one identical
> assembled tarball is clean-installed into each throwaway profile, a real Chromium-family browser opens the
> first-run and Settings surfaces from the installed bundle, and History/Privacy APIs return HTTP 200.
> The publication preflight, a non-dev version and matching changelog are still required before tagging.
> This is a verified release-candidate path, **not** a claim that the public alpha has already shipped.

## v0.1.0-alpha.1 readiness

| Gate | Status |
|---|---|
| Public repository, security reporting, issue/PR templates | ✅ |
| Timeline Orbit brand assets and social-preview asset | ✅ |
| Package icon and localized plugin metadata included in the tarball | ✅ |
| Host plugin install from a packed tarball | ✅ |
| Native collector built on its own macOS / Windows / Linux runner | ✅ |
| Shared collector protocol checks on macOS / Windows / Linux | ✅ |
| One tarball contains all three native collectors + SHA-256 provenance | ✅ |
| Same tarball clean-installs and reaches packaged collector handshake on macOS / Windows / Linux | ✅ |
| Installed bundle's **client panel**, first-run and Settings render from the clean install on all three OSes | ✅ |
| `pnpm verify:release:blockers` at release cut | ⬜ run at release cut |
| Non-`-dev` package version + matching changelog section | ⬜ set only when cutting the release |


## What ships

| artifact | command | status |
|---|---|---|
| plugin tarball | release assembly → `dsh-computer-history-<version>.tgz` | one artifact containing macOS, Windows and Linux collectors; native source commit, SHA-256 and size recorded in `bin/native-artifacts.json` |
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

## Installing from the tarball: three-platform Host, collector and browser UI path verified

```bash
npm pack                                        # dsh-computer-history-<version>.tgz
dsh plugin --profile <profile> add ./dsh-computer-history-<version>.tgz
# then list the package in the profile's package.json "bundles" and start the Host
#   the CLI normally does this itself for a package it installs for the first time; it does not repair a
#   package that was already in `dependencies` (an earlier failed attempt). Skipping it is silent: the log
#   says `pending (waiting for services: connection, workspaceRegistry)` and the Host never listens
#   (docs/development.md has the measurement)
```

The original local measurement proved that a packed plugin could become an active Host bundle. PR #118 then
measured the stronger three-platform distribution claim in GitHub Actions run `37623433497` from commit
`78ee8aae9957e24c1115dc795451080a26bbc8d4`. The matrix downloaded the **same assembled tarball** on every
platform and did not set `collectorExecutable`:

```text
Windows  install plugin: exit 0
         collector settles: state=running reason=no-apps-allowed collector=yes
         store opens: episodes/observations = 0|0

macOS    install plugin: exit 0
         collector settles: state=running reason=no-apps-allowed collector=yes
         store opens: episodes/observations = 0|0

Linux    install plugin: exit 0
         collector settles: state=permission-required
         reason=no X display: ... DISPLAY is not set ...
         collector=yes
         store opens: episodes/observations = 0|0
```

The Linux result is the expected honest state for a headless hosted runner: the packaged AT-SPI collector launched
and completed its protocol handshake, then reported that no desktop display existed to observe. A real Linux
desktop still needs its X/AT-SPI bus and permissions; the package no longer needs a locally built collector or a
manual executable override.

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

**Installed client product-path evidence — issue #44:** PR #124, packaged-alpha workflow run
[`37718046372`](https://github.com/ysr666/dsh-computer-history/actions/runs/37718046372),
from source commit `f201bf199da9c035579d49f8bcbdead58effd4df`, completed successfully on
`macos-14`, `windows-latest` and `ubuntu-latest` (2026-10-08 UTC). The installed DSH CLI was
`@deepseek-ai/dsh@0.2.0-rc.2`, with an isolated `DSH_HOME` and fresh profile `e2e` on each OS.

The same three-platform tarball was installed using `dsh plugin --profile e2e add`, without a
`collectorExecutable` override or checkout symlink. A Chromium-family browser confirmed that:

- `lib/client.js` realpaths into the throwaway profile's installed `node_modules/dsh-computer-history`;
- Computer History mounts a real `.ch-main` panel from the installed client;
- the clean store shows a `.ch-first-run` view with an enabled onboarding action;
- the browser receives an HTTP **200** History response (`recent`, `timeline` or `threads`);
- the plugin's Settings section mounts **8** rows and receives HTTP **200** responses to both
  `/api/computer-history/policy` and `/api/computer-history/retention`.

The workflow retains separate first-run and Settings screenshots, rendered text and structured results
for each platform, without uploading Host login tokens or session cookies. Packaged collector handshakes
still pass on all three: Windows and macOS report `running`; the headless Linux runner correctly reports
`permission-required` without an X display. This does **not** substitute for Linux live GUI/AT-SPI
acceptance inside a real desktop session.

The tag remains unpublished until the release preflight and version/changelog gates pass.

## Publishing

Do not publish `v0.1.0-alpha.1` until the readiness table above has no product blocker.
The version/changelog/tag changes are intentionally deferred until that point so a public
branch cannot accidentally look release-ready before the installed client path is proven.

Push a tag named `v` + the version in `package.json` (`.github/workflows/release.yml`). The workflow builds
the macOS, Windows and Linux collectors on their native runners, refuses mixed-source artifacts, assembles one
tarball, records native hashes, runs `pnpm verify:release`, then clean-installs that exact tarball on all three
platforms. GitHub Release publication happens only after all three packaged collector handshakes **and**
browser client/first-run/Settings + History/Privacy checks pass. **It needs
no certificate and no repository secret.**

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

### Running the release package gate

`pnpm native:build` intentionally builds **only the collector for the current OS**. A release tarball requires
the three artifacts produced on their native runners, so a single-machine `pnpm pack` is not a valid substitute
for the release assembly anymore.

The reproducible pre-tag gate is the **Packaged alpha matrix** workflow. After all three native artifacts have
been downloaded into `bin/`, the assembly steps are:

```bash
pnpm native:manifest
DSH_NATIVE_PREBUILT=1 pnpm pack --pack-destination /tmp
DSH_RELEASE_TARBALL=/tmp/dsh-computer-history-<version>.tgz pnpm verify:release
```

The `DSH_NATIVE_PREBUILT=1` guard is deliberate: it prevents the assembly machine from silently rebuilding one
platform's collector and replacing the bytes that came from that platform's runner. The public release workflow
uses the same assembly and three clean-install gates; it has not published a tag yet.
