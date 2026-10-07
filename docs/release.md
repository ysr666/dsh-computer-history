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

## Installing from the tarball: verified

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

**Client half verified 2026-10-06.** A second clean throwaway profile was created only through
`dsh plugin add`, then booted with the Desktop Host/runtime actually shipped by the QA application
(`DSH_CLIENT_VERSION=0.2.0-rc.2`). The boot manifest contained the installed
`dsh-computer-history/client.js`; a brand-new browser profile then rendered the Computer History sidebar
entry, the plugin first-run page, and the native Settings page. `/state`, `/timeline`, and the privacy
redaction preview all returned 200 from that same installed profile. No checkout junction, symlink, or manual
client injection was used. The exact measured path and the reason the machine's older global `dsh 0.1.2-rc.1`
was not used as the runtime are recorded in `docs/validation-installed-bundle-2026-10-06.md`.

## Publishing

Do not publish `v0.1.0-alpha.1` until the readiness table above has no product blocker.
The version/changelog/tag changes are intentionally deferred until that point so a public
branch cannot accidentally look release-ready before the installed client path is proven.

Push a tag named `v` + the version in `package.json` (`.github/workflows/release.yml`). The workflow installs
both the root project and the separate `extension-editor` pnpm project, builds the plugin, runs the same portable
gate as `main`, then runs the macOS **product journey** before it creates the release artifact. The second install
is required on a clean runner because root `pnpm install` does not populate `extension-editor/node_modules`,
while `prepack` builds the VS Code extension through its local `@vscode/vsce` dependency.

That journey installs public `@deepseek-ai/dsh@0.2.0-rc.2` into a throwaway directory, downloads the current
Stable Chrome for Testing from Google's `last-known-good-versions-with-downloads.json`, and exercises a
release-shaped Computer History tarball end to end. Only after that passes does the workflow build the collector,
pack, run `pnpm verify:release`, and create the GitHub release with the tarball attached and the changelog section
as the notes. **It needs no certificate and no secrets.**

### Product-journey release gate

`pnpm e2e:product-journey` is intentionally not part of ordinary `pnpm verify`: PR CI is portable Linux/Node,
while this gate qualifies the actual macOS product surface. It creates a throwaway DSH profile and checks the
user path that unit tests cannot prove as one system:

- install the packed plugin and complete first-run consent;
- install/pair the Editor Companion and load the real Browser Companion in Chrome with CDP `Extensions.loadUnpacked`;
- run the Browser privacy matrix, including canonical URL query/fragment stripping, denied resources, incognito,
  extension off, and rotated-token rejection;
- produce `Editor → short Browser detour → Editor save/test success` and prove it remains one workspace Episode
  with four evidence links and four summary citations;
- Continue into a new DSH Session and prove the native `@ Computer History` capsule binds to that exact Episode
  without sending a model request;
- disable/re-enable without losing history, then deselect/unload and remove the package while preserving the
  history database and continuation binding.

The fixture collector at `scripts/fixtures/e2e-fake-collector.mjs` is protocol-only: it reports a healthy
collector lifecycle so the release gate does not need macOS Accessibility permission, and it never reads the
desktop. Native Accessibility capture is still covered by the native collector validation. Browser behavior is
not mocked: the gate loads the built extension into a real Chrome process.

A plain web-profile Host and the Desktop shell have different package-manager lifecycle ownership. The journey
therefore accepts both correct forms: Desktop/HMR may unload immediately; a web Host may apply bundle
deselection on restart. Package removal itself is then verified through `dsh plugin --profile ... remove`, the
same DSH CLI package-manager path used to manage the throwaway profile.

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

The portable artifact preflight is still:

```bash
pnpm native:build                    # ad-hoc; the log says which signature it made
pnpm pack --pack-destination /tmp
DSH_RELEASE_TARBALL=/tmp/dsh-computer-history-<version>.tgz pnpm verify:release
```

For the full installed-product gate, install the independent Editor Companion project as a clean runner would,
then provide any DSH 0.2.x CLI and Chrome/Chrome for Testing binary:

```bash
pnpm --dir extension-editor install --frozen-lockfile
DSH_CLI=/path/to/dsh \
PANEL_CHROME='/path/to/Google Chrome for Testing' \
pnpm e2e:product-journey
```

If `PANEL_CHROME` is omitted on macOS the script uses the normal Google Chrome application path. The release
workflow does not depend on a runner's preinstalled browser: it resolves the current Stable Chrome for Testing
from Google's official JSON endpoint and passes that binary explicitly.

Measured 2026-10-05 with the version still at `0.1.0-dev.0`: `pnpm verify:release` exits 1 and names what is
actually missing - the `-dev` version and the absent changelog section - while the signature check passes.
The release workflow itself has not run yet: it needs a tag, which is the owner's call.
