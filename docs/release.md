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
