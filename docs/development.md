# Development

## Required toolchains

- Node.js ^22.19.0 or >=24
- pnpm 11.7.0
- TypeScript 6
- Swift toolchain for native macOS work

## Core commands

    pnpm install
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm verify

Native verification commands:

    pnpm native:build
    pnpm native:test

## Development order

Follow ARCHITECTURE.md, SECURITY.md, docs/development.md, and the Phase 1 Implementation Spec. Contracts, store, and deterministic core are built and reviewed before native, UI, and automatic resume integration.

## Local data

Never use real personal Computer History as a normal test fixture. Unit and integration fixtures must be synthetic. Live AX output stays under ignored local directories and must be reviewed before sharing.

## A Host of your own, with a clean store

Panel work needs a Host you can drive without touching anyone's session, and first-run work
needs a store that has never recorded anything. Both come from a profile of your own inside
the real `~/.dsh`, because profile bundles resolve from the installation:

```bash
cp -R ~/.dsh/profiles/web ~/.dsh/profiles/firstrun    # a profile known to boot
# then add this plugin as a patch entry with its own dataDirectory, and:
dsh --profile firstrun web --port 19420                # writes an authenticated URL to stdout
```

What is **not** the way, measured rather than assumed:

- copying a profile into a **temporary** `DSH_HOME`: the profile's own bundles and its local
  `file:` dependencies do not resolve there (`cannot resolve profile bundle ...`), and
  `dsh plugin --profile <name> install` fails on the `file:` dependencies that point at
  another checkout;
- reading the auth cookie from `~/.dsh` after the fact: no file under `~/.dsh` holds
  `dsh-auth-*` - the token exists in the running process and in the browser that opened the URL,
  which is why a Host of your own is the reliable route, and why the URL from stdout must be
  kept rather than rediscovered;
- `~/.dsh/ext-bridge-token` is the browser bridge's token, not the web session cookie
  (`/state` answers `unauthorized` with it).

## Why an installed bundle can still show no interface

Measured while installing this plugin into a profile as a bundle (`dsh plugin --profile ... add`):
the host half mounted and answered `/state`, and the panel never appeared, with **no request for
the client bundle at all** - not a 404, simply nothing. What was ruled out, in order:

| checked | result |
|---|---|
| the interface itself | renders; another bundle-installed plugin's panel is alive in the same window, so the environment and the bundle mechanism are fine |
| the browser console | only 404s from a third plugin's routes (`/memory-evolve/api/*`), unrelated |
| `package.json` `type` | `module`, same as the working example |
| `exports["./client"]` | `{ types, default: ./lib/client.js }`, same shape as the working example |
| `dsh.client` | `{ platform: web, inject: [...] }`, same shape |
| the built client bundle | correct: `window.__ModuleLoader__.load({ id: "dsh-computer-history", factory })` |

**Falsified by measurement:** the hypothesis that the interface does not know about the client
half at all. `window.__DSH_BOOT__.entries` contains this plugin, with a client URL of its own:

```text
{"id":"dsh-computer-history","url":"/plugins/??dsh-computer-history/client.js&rev=...","inject":[...]}
{"id":"dsh-vision-router",  "url":"/plugins/??dsh-vision-router/client.js&rev=...","inject":[...]}
```

So the list is composed correctly and the discovery works; the failure is in **fetching or
executing** that module. A direct request to a hand-rebuilt URL returns 404 for the working plugin
as well, which makes that test worthless - the next attempt must read the **actual** request from
the Network events (filter for `computer-history`, log its status and response body) rather than
rebuilding the URL from the boot entry.

The rule this session keeps relearning applies here too: the failure is silent, so every claim above
is a measurement, not a reading.
