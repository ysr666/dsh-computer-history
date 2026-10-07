# Installed bundle: Host + client proof — 2026-10-06

This record closes the product-path question tracked by issue #44: whether a freshly packed
`dsh-computer-history` tarball works as an installed DSH bundle **including its client panel and Settings
surface**, rather than only when the checkout is wired into a development profile.

## Artifact and clean profile

The artifact was produced from the working tree with `pnpm pack`; `package/lib/client.js` in the tarball was
SHA-256 identical to the freshly built `lib/client.js` before installation. A new throwaway DSH home and profile
were then created from nothing:

```bash
export DSH_HOME=/tmp/dsh-ch-installed-bundle-proof-final-<stamp>
dsh plugin --profile bundleqa add /tmp/dsh-ch-final-install-proof/dsh-computer-history-0.1.0-dev.0-final-<stamp>.tgz
```

There was no checkout junction, node_modules symlink, hand-copied plugin directory, or existing profile. The
plugin manager wrote the `dsh-computer-history` file dependency and bundle entry itself.

The clean profile also needs DSH's web application in order to have a client UI at all:

```bash
dsh plugin --profile bundleqa add @deepseek-ai/dsh-web-app@0.2.0-rc.2
```

The profile generator requires an explicit decision for `koffi`'s install script; this proof set
`allowBuilds: { koffi: false }`, i.e. it did **not** execute that optional native build. The only Computer History
runtime override was `companionPort: 19688`, because the production Host on the same Mac already owned the
normal companion port. No client injection or plugin loader wiring was added by hand.

## Which DSH version did what

The machine's global `dsh` command is `0.1.2-rc.1`. It was used only as the **plugin manager** above. Booting the
new profile with that old global Host is not a supported measurement for current packages: the official
`@deepseek-ai/dsh-web-app@0.2.0-rc.2` itself fails there with cross-version package/API errors.

The runtime proof therefore used the DSH Desktop Host that this machine's QA Desktop actually ships, with
`DSH_CLIENT_VERSION=0.2.0-rc.2`, the same desktop-host/runtime/pnpm paths that the application uses. That Host
reached `ready` on the clean `bundleqa` profile.

## Client assembly proof

The ready boot manifest contained an application-phase entry with:

```text
id: dsh-computer-history
url: plugins/??dsh-computer-history/client.js&rev=...
inject: locale, renderer, layout, sidebar, slots, settings
```

That is not the acceptance by itself; it establishes that the client half came from the installed package. The
browser checks below establish that it actually mounted and rendered.

## First-run API proof

From a fresh browser session against that Host, the installed package returned:

```text
GET /api/computer-history/state                         -> 200
  enabled: false
  capture: stopped
  firstRunPreset: present
  companion.listening: true (isolated test port 19688)

GET /api/computer-history/timeline?days=1               -> 200 []
GET /api/computer-history/audit/preview?scope=app:...   -> 200
  built-in protected password-manager bundle ids: present
  protected key/.env/.ssh/credentials/secrets patterns: present
```

The empty timeline is the expected clean-store result. The point of this row is that the Host API from the
installed tarball is alive and its privacy boundary is present before recording starts.

## Panel and Settings proof

A brand-new headless Chrome profile (no reused DSH browser state) opened the Host. After dismissing DSH's own
product/model onboarding dialogs, the measurements were:

```text
sidebar Computer History entry: present and clickable
.ch-main:                      present
heading:                       电脑使用记录
status:                        尚未开始 · 仅记录元数据 · 准备好后开始记录
first-run surface:             present
开始并授权 button:              91 px, white-space nowrap, clipped=false

Settings -> 电脑使用记录:       present and selectable
记录:                           present
参与的应用:                     present
历史保留多久:                   present
浏览器伴侣:                     present
VS Code 伴侣:                   present
数据:                           present
删除历史:                       present
```

Evidence produced by the same run is under `.debug/installed-bundle-proof-2026-10-06/` during development:
`installed-bundle-evidence.json`, `installed-first-run-panel.png`, and `installed-settings.png`.

## Result

The packaged install path is verified end-to-end on the supported Desktop 0.2.0-rc.2 runtime: the Host plugin
starts, its client bundle is assembled from the installed package, the sidebar panel renders, Settings renders,
and first-run History/Privacy API requests succeed. The client no longer requires checkout-only wiring or a
manual junction.
