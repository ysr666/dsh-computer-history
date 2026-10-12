# DSH Computer History: Web Client development (Live Reload and native HMR)

> **Status (2026-10-12):** Native DSH Web HMR and fail-closed staged
> development builds are merged in `main`. `pnpm dev:client` supports
> build-only, default full-page refresh, and opt-in `native-hmr` modes.
> **No published product or Desktop behavior is changed by this tooling.**

This **optional, development-only** tool rebuilds the existing `tsdown` Client
factory after edits under `src/client` and `src/shared`. It does not replace the
published DSH `window.__ModuleLoader__.load({ id, factory })` contract with ESM,
does not install the plugin, does not change the Host or native collector, and
does not modify the normal `build`/release path.

## Development modes at a glance

| Mode | Configuration | Outcome |
| --- | --- | --- |
| Build only | `pnpm dev:client` | Rebuild safely; do not launch a browser |
| Full-page Web reload | Set `DCH_DEV_BROWSER_URL`, `DCH_DEV_CHROME_BIN`, `DCH_DEV_PUPPETEER_ENTRY` | Refresh the isolated Chrome page after a successful rebuild; default mode |
| Native DSH Web HMR | Same browser settings, plus `DCH_DEV_RELOAD_MODE=native-hmr` | Let upstream DSH replace the Client fiber without page navigation |

For an older Host or unavailable `/plugins/events` endpoint, select
`DCH_DEV_RELOAD_MODE=page` (or omit the mode variable). This is not React
Fast Refresh; plugin-local UI state may reset and the Host must be restarted
for Host/native collector changes.

## Build-only mode

```sh
pnpm dev:client
```

The initial build and every edit use the **development-only staged builder**
(`scripts/dev-staged-build.mjs`). It runs the same `tsdown` compilation in a
temporary directory, validates the Client factory and Host/Client declarations,
then atomically publishes the new Client **last**. Regular `pnpm build` and
release packaging are unchanged. Source edits are debounced and builds are
serialized; compiler/validation failures leave the last-good `lib/` intact.
No browser refresh is requested on a failed build.

Editing Host-only files or native collector code does **not** hot-reload the
running Host; restart its isolated profile as needed. The watch intentionally
does not follow `lib`, `.promo`, `native`, or other generated directories.

## Optional browser full reload

First start an **isolated DSH Web profile** with its plugin entry pointing to
this checkout's `lib/index.js`. Do not point it at a copied npm package or
another checkout; then use an explicitly local HTTP URL on `127.0.0.1`,
`localhost`, or `::1`:

```sh
export DCH_DEV_BROWSER_URL='http://127.0.0.1:PORT/'
export DCH_DEV_CHROME_BIN='/absolute/path/to/Google Chrome'
export DCH_DEV_PUPPETEER_ENTRY='/absolute/path/to/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js'
pnpm dev:client
```

The watcher opens a private Chrome instance after the first successful build
and reloads it after each subsequent successful build. `DCH_DEV_HEADLESS=1`
enables headless mode for isolated tests. `puppeteer-core` must be installed
separately as developer tooling; this plugin acquires **no runtime dependency**.
Use the private Chrome window for Host authentication if required. If a test
URL already contains an authentication token, never commit or paste that URL
into logs. The tool does not print the URL and uses a private CDP pipe rather
than a remotely accessible Chrome debugging port. Ctrl+C terminates the owned
Chrome. Browser failures cannot turn a successful build into a broken build.

**The default `page` mode is full-page Live Reload, not HMR.** It resets
browser component state. With the opt-in `native-hmr` mode described below,
upstream DSH instead replaces the Client module without navigating the page;
the plugin's own React-local state can still reset. Both modes are for
isolated development only: never use real History data or your everyday
Desktop profile. Desktop custom-scheme HMR is not supported here.

Computer History itself has now passed isolated DSH 0.2.0-rc.2 + real
Chrome A→B→C native swaps (one initial page navigation, no unexpected browser
JavaScript errors) and a later 30-cycle stress run with stable observed CSS
counts. The complete `src/client` → watcher → HMR → broken TypeScript →
last-good bundle preserved → source recovery → HMR flow was separately tested
with the Host left running. This does **not** establish blanket stable/preview,
multi-tab, long-running memory, or Desktop compatibility.

## Upstream native Web HMR (opt-in)

DSH 0.2.0-rc.2 includes `@deepseek-ai/dsh-client-hmr` by default in the Web
composition. Its Host half watches the *emitted* `client.js` entry and
publishes an SSE `rebuilt` event on `/plugins/events`. The browser replaces the
plugin's Cordis fiber without page navigation. This keeps workspace and page
state unrelated to Computer History, but the plugin's **own React component
state is reset**. It is not React Fast Refresh, does not upgrade Host modules,
and does not support Electron's independent Desktop scheme.

With the same-checkout isolated Host and Chrome variables described above, opt in:

```sh
export DCH_DEV_RELOAD_MODE=native-hmr
pnpm dev:client
```

The isolated Chrome helper confirms the boot graph has the HMR plugin and that
`/plugins/events` responds with an SSE stream before suppressing its former
page reload. A missing HMR service fails loudly and closes the private Chrome
rather than silently claiming hot updates. Set `DCH_DEV_RELOAD_MODE=page`
(or omit the variable) for the existing full-page fallback. Build-only watch
also works with a separate browser already using upstream Web HMR.

The upstream module lifecycle, not this developer script, owns cleanup,
CSS and dependent plugin reactivation. Runtime changes to the native collector,
Host code, permissions, store, or settings still require a separate Host
validation. Other DSH versions and OSes must be verified before broad claims.

## Preserve last-good Client when TypeScript compilation fails

`pnpm build` deliberately deletes `lib/` as the first packaging step. A syntax
error in `src/client/` then removes the deployed `client.js`, despite the dev
watcher's promise not to refresh. Upstream DSH HMR polls this file on its own.

The **development-only** watcher now uses `scripts/dev-staged-build.mjs` to
compile all `tsdown` outputs into a temporary directory with the optional
`DCH_DEV_BUILD_OUT_DIR` override, verify the complete Client/Host declarations,
and publish all output siblings with atomic renames and `client.js` last.
Build errors leave the last-good `lib/` unchanged, so the existing browser
plugin stays running. The ordinary `pnpm build`, `prepack`, production output
and package loading contracts remain unchanged. Disk failures during sibling
publication are not transactional; repair with a clean build and restart.
