# Release: install, upgrade, roll back

This document states what has been **measured**. Where a step has not been
verified, it says so rather than describing the intention.

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

## A correction, owed to the earlier reading

A previous version of this file said the packaged plugin "does not start" while a
checkout install does. That was wrong, and the phase that found the error is the
one to say so: a **freshly created package under a new name**, never loaded before,
also came back without a fiber in the same Host session, and so did the checkout.
What looked like a property of the tarball was the state of the running Host after
many load/unload cycles - any newly created entry stops getting a fiber.

Until that is understood, treat "it did not start" in any measurement here as
suspicious of the environment first. The tarball's contents are still verified
byte-for-byte; whether it starts is **unknown**, not known-bad.

## Installing from the tarball: **not verified**

```bash
pnpm pack:plugin
tar xzf dsh-computer-history-*.tgz \
  -C ~/.dsh/profiles/<profile>/node_modules/dsh-computer-history --strip-components=1
```

Measured three ways - a bare copy, the package's peers provided beside it, and the
package declared in the profile's `dependencies` and `bundles` - the loader entry
comes back with `fiber.state = none`: created and never started. A checkout install
at the same path is `[active]`, and the packaged `lib/` and manifest are
byte-identical to the working tree.

The most consistent explanation is that a **profile-declared bundle is assembled at
Host startup**, while the runtime path that starts a plugin is the development one.
That is a hypothesis with one supporting observation, not a verification.

**Until it is verified, this document does not tell you to install from the
tarball.** The artifact is complete; "the file is fine" is not "it runs".

## Upgrading

```bash
git pull && pnpm install && pnpm verify     # the gate must be green before upgrading
pnpm build
# restart the Host, or reload the plugin entry
```

Migrations run on open with contiguous versions; `pnpm verify:migrations` proves
the invariants and the frozen-v1 upgrade test asserts the latest version, so an
upgrade from a v1 store is covered by that path.

## Rolling back

The store is a single SQLite file in the data directory. A rollback that crosses a
migration is **not** just reverting the code: the schema is then newer than the
code. Instead:

1. stop the Host;
2. copy the store file aside - it is the whole history;
3. check out the older revision, `pnpm install && pnpm build`;
4. open the Host with a fresh data directory, or restore a store file that matches
   that revision.

Deleting the store file is a complete and irreversible rollback of local history;
the panel's **Delete all history** does the same from inside.

## Removing it: verified

Run on this machine, with the output that came back:

```bash
rm -f ~/.dsh/profiles/<profile>/node_modules/dsh-computer-history   # the junction
rm -f ~/.dsh/computer-history                                       # the store symlink
rm -f ~/.dsh/computer-history-editor.log                            # the editor companion's trace
code --uninstall-extension dsh-local.dsh-computer-history-editor     # the editor extension
# and remove the settings keys dshComputerHistory.* from the editor's settings.json
```

```text
store symlink        gone
junction             gone
editor log           gone
editor extension     0 remaining
history file         176128 bytes, still there
port 19388           still listening
```

Two of those lines are the interesting ones:

- **The history is kept.** Removing the software is not the same as deleting the
  record, and it must not be: the store file is the whole point of the product. It
  stays where it is until the user deletes it (the panel's "Delete all history" does
  that from inside, and `docs/release.md` does not do it for them).
- **The port stays open until the Host restarts**, because the running plugin holds
  it. Nothing is left on disk, and the listener disappears at the next start - which
  is worth knowing rather than discovering.

Nothing else was left behind: no profile `dependencies` or `bundles` entries (there
were none to remove), no patch residue in any profile, and no stray files in the
editor's extension directory.

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

**Still open, and stated as such:** the **client half** of an installed bundle does not appear in
the interface on this Host yet, so the install is verified for the host plugin and *not* for the
panel. Until that is fixed, this document says so rather than claiming a complete install.

## Publishing

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
