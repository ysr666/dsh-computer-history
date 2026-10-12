# DSH Computer History: isolated Web client live reload

This **optional, development-only** tool rebuilds the existing `tsdown` Client
factory after edits under `src/client` and `src/shared`. It does not replace the
published DSH `window.__ModuleLoader__.load({ id, factory })` contract with ESM,
does not install the plugin, does not change the Host or native collector, and
does not modify the normal `build`/release path.

## Build-only mode

```sh
pnpm dev:client
```

The initial build and every edit run the same `pnpm build` contract as the
normal build. Source edits are debounced; builds are serialized so two clean
passes cannot overwrite each other's `lib` output. On failure the watcher
continues and **does not refresh the browser**. It checks that `lib/client.js`
still declares the DSH factory and `lib/client.d.ts` exists. Editing Host-only
files or native code does **not** hot-reload the Host; restart your isolated
Host if those components change. Source watch intentionally does not follow
`lib`, `.promo`, `native`, or other output directories.

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

**This is full-page Live Reload, not HMR.** Browser React state is reset; no
Client module is replaced in-place. It is only for development; do not use
real History data or your everyday Desktop profile as a test fixture. No
promise is made for Desktop custom-scheme HMR.

The companion prototype in `Agent Picket` passed isolated DSH 0.2.0-rc.2
A→B bundle refreshing. Computer History must separately prove its own real
DSH stable/preview Web behavior, including authenticated navigation and
multi-tab reload, before claiming broad compatibility.
