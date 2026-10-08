# Development

## Required toolchains

- Node.js ^22.19.0 or >=24
- pnpm 11.7.0
- TypeScript 6
- Swift toolchain for native macOS work

## Core commands

    pnpm install
    pnpm --dir extension-editor install --frozen-lockfile  # required before pack / release-shaped E2E
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

## A Host of your own must be the same DSH version as the interface you compare against

Cost of learning this: eleven rounds.

The panel registers `main` and `sidebar.panellist`. Those slots exist in **0.2.0-rc.2** (what the
desktop app runs) and **not** in **0.1.2-rc.1** (what `dsh` on `PATH` installs). A Host booted from
the older CLI therefore renders no such slot, the registration silently does nothing, and the
symptom is indistinguishable from a broken plugin: the client bundle is in
`window.__DSH_BOOT__.entries`, its request returns 200, no exception is thrown, and nothing appears.

Check the version before concluding anything about the plugin:

```bash
node -e 'console.log(require("/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json").version)'
defaults read "/Applications/DeepSeek Harness.app/Contents/Info.plist" CFBundleShortVersionString
```

Everything else in this section was measured while chasing that mismatch, and two hypotheses were
falsified on the way - "the interface does not know about the client half" (it does), and "the
working example is a valid control" (it registers different slots, so it was not). The ruled-out
list is still useful, but it was all downstream of the version check that should have come first.

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

## Running the whole macOS flow with one command

`pnpm e2e:macos` builds the tarball, installs it into a throwaway `DSH_HOME`, boots the Host on its own ports,
checks that it answers and that the companion either listens or names why not, writes its artifacts under
`.debug/e2e-macos/`, and cleans up. It never touches `~/.dsh`. Set `DSH_CLI` if the `dsh` on `PATH` is not the
CLI to use, and `DSH_E2E_KEEP=1` to keep the throwaway home for inspection.

Measured 2026-10-05: nine checks, green, two runs in a row, with the collector reported as
`state=degraded reason=collector-exited` - a collector spawned by a command-line Host has no Accessibility
grant, which is the one part of the flow this command cannot cover, and it says so instead of pretending.

## When `dsh plugin add` succeeds and the Host still starts with nothing

Measured 2026-10-05: a profile created by the CLI, with `dsh plugin --profile <p> add <tarball>` answered with
exit 0, starts **without a web listener and with one warning line and nothing else**:

```
dsh: warning: 1 entry did not activate
computer-history (dsh-computer-history): pending (waiting for services: connection, workspaceRegistry)
```

The cause is the entry `docs/release.md` describes in a comment, in a state the CLI does not repair by itself:
the profile's `dsh.profile.bundles` list has to contain the plugin, and this plugin needs the two services the
web application provides. Measured 2026-10-05: a fresh profile installed in one successful run **does** get the
entry - `dsh.profile.bundles` came out as `["@deepseek-ai/dsh-base", "dsh-computer-history"]` - because the
plugin manager reconciles *newly installed* bundles. What it does not do is reconcile a package that was
**already** a dependency: an earlier attempt that failed after writing `dependencies` leaves it out on the retry
(`beforeDeps.has(name)` skips it), and then this plugin stays pending with only that one warning line. Listing
the package in `dsh.profile.bundles` and restarting is what fixes it. Measured with the same command into an
already-working profile, where the plugin activates normally.

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


## Verifying the native Continue capsule

Continue means continue inside DSH, not reopen the foreground application. A real DSH 0.2.x render must leave
one native ReferenceChipNode in the composer.

Run an isolated QA/profile Host with stdout redirected to a local temporary log, seed a synthetic Episode, then:

    CAPSULE_HOST_LOG=/tmp/dsh-capsule-host.log pnpm verify:continuation-capsule

The script reads the Host's local token URL from that file, launches its own headless Chrome profile, opens
Computer History, clicks Continue, and asserts that data-composer-chip=computer-history exists, is non-editable,
renders the standard @ Computer History face, yields the panel to Conversation, and exposes no hidden handoff
prompt in the page. Evidence is written under .debug/continuation-capsule-runtime/.

Do not point this runtime check at the owner's normal Desktop profile. Use a throwaway DSH_HOME and synthetic
history data.

## Verifying the Continue execution path

The browser capsule check proves the visible/native UI seam. The execution seam is separate and must not depend on
a real cloud model or on the model choosing to call a History tool.

Run:

    pnpm verify:continuation-send

This creates a real rc.2 AgentLoop with a deterministic fixture LLM, submits the durable
`@"Computer History"` user message, and captures the first real model request. The assertion requires that request
to contain the bounded `ContinuationBootstrap` even though the fixture model never calls
`computer_history_continue`. It also asserts that Episode/session ids, Episode summary prose, and evidence ids do
not enter the automatic Bootstrap.

`computer_history_continue` remains available in the request as an optional deep-history tool. It is not a
prerequisite for starting the continuation turn. Prior-session text projection is also optional: use the public
`sessionQuery.readSurface()` seam only when a provider is already present; stock Desktop must not be prevented from
loading when that optional service is absent. Runtime Bootstrap delivery is binding-driven: the Agent-scoped
`system-prompt/assemble` seam checks the local Session→Episode continuation binding directly for the first open
turn. Do not arm automatic continuation from `agent/inbox/claimed`; the real Desktop composition is not equivalent
to the fixture event topology. The binding is consumed when that continuation turn stops or errors.
