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
> The installed **client half** is verified on the macOS full product journey (52/52 checks including
> Continue, disable/re-enable and uninstall). A separate release browser gate now covers **Windows, macOS and
> Linux** using the same assembled tarball, verifying the first-run panel, Settings and successful History/Privacy
> responses without checkout wiring. Issue #44 was closed by the macOS product-path PR #125; the added three-OS
> browser gate qualifies the wider three-platform Alpha claim. The public tag is **not published** and still
> requires a non-dev version, changelog and release-cut preflight.

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
| Installed client/Settings full product journey | ✅ macOS 52/52 from PR #125 |
| Same installed client renders first-run and Settings, returns History/Privacy HTTP 200 | ✅ Windows / macOS / Linux packaged browser matrix |
| `pnpm verify:release:blockers` at release cut | ⬜ run at release cut |
| Non-`-dev` package version + matching changelog section | ⏳ staged by release preparation PR; validate on merged main before tagging |


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

## Installing from the tarball: three-platform Host/collector path verified; installed client path verified on macOS

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

**Installed client path measured on macOS.** The release product journey uses `dsh plugin add` in a clean
throwaway DSH 0.2 profile, starts the installed bundle, renders the Computer History sidebar and Settings surface,
completes first-run consent, exercises History/Privacy requests, creates a native `@ Computer History` Continue
capsule, and verifies disable/re-enable/uninstall while preserving history. The detailed installed-bundle evidence
is recorded in `docs/validation-installed-bundle-2026-10-06.md`.

Issue #44's installed-client acceptance criteria have been verified and the issue is closed. The later
three-platform packaged-client matrix now also checks first-run, Settings and History/Privacy on
macOS, Windows and Linux without checkout wiring. These hosted-runner browser checks do not claim
a full Linux desktop accessibility session or the complete 52-check lifecycle on every OS.

## Three-platform installed browser proof

The expanded browser product-path gate was verified in GitHub Actions run
[`37718627060`](https://github.com/ysr666/dsh-computer-history/actions/runs/37718627060)
for source commit `fc5aee2c08b60b744d947a47b6e3702a83aa0a10` (2026-10-08 UTC).
The matrix assembled **one** native-provenance tarball, then used DSH
`@deepseek-ai/dsh@0.2.0-rc.2` and a fresh isolated `e2e` profile on all three operating systems.

A real Chromium-family browser verified the client `lib/client.js` resolves **inside the installed
profile**, mounted `.ch-main`, first-run `.ch-first-run` with an enabled action, the Computer History
Settings surface with **8 rows in that historical run** (expanded by later changes), and **HTTP 200 responses** for History (`recent`, `timeline` or
`threads`) and both Privacy endpoints (`policy`, `retention`). The run's separate platform jobs
all passed, with screenshots, rendered text and structured results. Uploads deliberately exclude
Host logs and session credentials. Windows/macOS packaged collectors reached `running`; the Linux
headless runner reported `permission-required` with no X display, rather than claiming it observed
a desktop. Actual Linux desktop/AT-SPI GUI acceptance remains distinct.

The tag-publishing workflow preserves the macOS complete installed-product journey from PR #125
**and** now runs the three-OS browser product gate. The gates will rerun from the tagged release
commit; the public Alpha has not yet been published.

## Publishing

Do not publish `v0.1.0-alpha.1` until the release-cut preflight is green on the **final
main commit**, the release package version and changelog match, and any required safety fixes are
merged and verified. Issue #44 is already closed; do not treat open Dependabot maintenance PRs as
automatic release blockers. The release preparation PR stages the version and notes but **must not
create or push a tag**.

Push a tag named `v` + the version in `package.json` (`.github/workflows/release.yml`). The workflow builds
the macOS, Windows and Linux collectors on their native runners, refuses mixed-source artifacts, assembles one
tarball, records native hashes, and then runs the macOS **product journey against that exact assembled tarball**.
After `pnpm verify:release`, the same tarball clean-installs on all three platforms. GitHub Release publication
happens only after the installed client journey and all three packaged collector handshakes pass. **It needs no
certificate and no repository secret.**

### Product-journey release gate

`pnpm e2e:product-journey` is intentionally **not part of ordinary `pnpm verify`**: PR CI stays portable and fast,
while release qualification needs a real macOS DSH/Chrome product surface. When `DSH_PRODUCT_TARBALL` is set, the
journey skips its development-time pack step and installs that supplied tarball directly. The release workflow
points it at the just-assembled three-platform artifact, so the UI gate and packaged transport gates qualify the
same plugin bytes.

The journey verifies the user path that unit tests cannot prove as one system:

- clean `dsh plugin add` install and first-run consent;
- Editor Companion install/pairing and the real Browser Companion loaded into Chrome;
- the Browser privacy matrix, including canonical URL stripping and rotated-token rejection;
- `Editor → short Browser detour → Editor save/test` as one evidence-backed Episode;
- Continue into a new DSH Session with the native `@ Computer History` capsule bound to that Episode;
- disable/re-enable and package removal while preserving history and continuation binding.

The protocol-only collector fixture makes the journey independent of macOS Accessibility permission and never
reads the desktop. Native accessibility capture remains covered by the native collector validation.

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

`pnpm verify:release:blockers` (its own step in the workflow) checks the **current main
commit's push-triggered workflow results**, not unrelated failures on old SHAs. It fails if
current main is missing successful CI or has an incomplete/failed workflow, and if an open
**high or critical** Dependabot security alert exists. Other open PRs/issues and
inaccessible alert data are explicitly reported for manual review rather than silently
declared safe. It must be rerun at the final release cut.

### Running the release package gate

`pnpm native:build` intentionally builds **only the collector for the current OS**. A release tarball requires
the three artifacts produced on their native runners, so a single-machine `pnpm pack` is not a valid substitute
for the release assembly anymore.

The reproducible pre-tag gate is the **Packaged alpha matrix** workflow, which now runs
`pnpm verify:release` against the assembled artifact when the candidate has a non-`-dev`
version. The release-tag workflow additionally verifies the native macOS signature from
macOS and runs the complete installed product journey before publication.

After all three native artifacts have
been downloaded into `bin/`, the assembly steps are:

```bash
pnpm native:manifest
DSH_NATIVE_PREBUILT=1 pnpm pack --pack-destination /tmp

DSH_CLI=/path/to/dsh-0.2 \
PANEL_CHROME='/path/to/Google Chrome for Testing' \
DSH_PRODUCT_TARBALL=/tmp/dsh-computer-history-<version>.tgz \
pnpm e2e:product-journey

DSH_RELEASE_TARBALL=/tmp/dsh-computer-history-<version>.tgz pnpm verify:release
```

The `DSH_NATIVE_PREBUILT=1` guard is deliberate: it prevents the assembly machine from silently rebuilding one
platform's collector and replacing the bytes that came from that platform's runner. The public release workflow
uses the same assembly and three clean-install gates; it has not published a tag yet.
