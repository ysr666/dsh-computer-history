# DSH 0.2.1-rc.5 × Computer History 1.1.0 — isolated packaged Web Host acceptance

Date: 2026-11-05 (China time; test artifact timestamps recorded in UTC on 2026-11-04).

## Tested identity and result

- Target: `@deepseek-ai/dsh@0.2.1-rc.5` CLI and `@deepseek-ai/dsh-web-app@0.2.1-rc.5`, both exact npm versions, installed under an isolated temporary directory.
- Plugin: CI-assembled `dsh-computer-history-1.1.0.tgz` from main commit `ff882d5c8f8f8da0d42eeec4174155bcf5ee0b54` (Actions run `41758731479`); SHA-256 `0a3988b1af4a338db3a667cb491c8a4b38e0d616ee2573270e45c7c01ba1ebb1`.
- Environment: macOS, genuine DSH Web Host, genuine Chrome with an unpacked Browser Companion; isolated `HOME`, `DSH_HOME` and Chrome user-data-dir; synthetic-only protocol collector. No production DSH profile or SQLite opened.
- **PASS: 56 of 56 product-journey assertions**, including cleanup of test-owned Chrome and Host listeners. Local evidence path (not committed): `.debug/e2e-product-journey/run-2026-11-04T17-42-59-056Z/checks.json`.

## Coverage

Exact tarball installed successfully; first-run consent, app-policy defaults, Browser Companion seven-cell privacy matrix, Editor Companion installation and active/save/verification observations passed. Normalized Browser and Editor evidence was linked to one Episode and shown in the real Host UI. Continue created an exact Episode-bound DSH Session capsule. Plugin disable/re-enable preserved observations and session binding. Uninstall removed the package and routes, preserving the original synthetic history. All test-owned listeners were cleaned.

## Why RC5 matters and what it does not prove

A read-only check on the owner's Mac found the installed **Desktop application bundle** `CFBundleShortVersionString=0.2.1-rc.5` while a separately installed terminal `dsh --version` returned `0.2.1-rc.2`. The Desktop bundle's displayed app version is **not** proof of its exact embedded Host API/ABI; verify that separately before an installed Electron upgrade.

This acceptance covers an isolated **Web Host + Chrome**, not native Electron interactions, accessible names/focus/VoiceOver, combined third-party bundle runtime, or a production `history.sqlite` migration. Issues #171 (Electron GUI), #172 (authorized backup/restore and rollout), and #173 (coexistence) remain open until their own gates pass. This test does not grant permission to stop production collectors, change profiles, or publish a release.

## Repeatable gate

The PR compatibility matrix covers `0.2.1-alpha.2`, `0.2.1-rc.2`, and `0.2.1-rc.5`, installing the exact Host/Web app against the **same assembled product tarball**, and preserving checks.json only. The local run explicitly opted into `koffi` build only in its disposable pnpm workspace. Re-run after any Host or product change; do not extrapolate to untested releases.
