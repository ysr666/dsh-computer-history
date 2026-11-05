# DSH 0.2.1-rc.5 — isolated multi-plugin Web Host coexistence

Date: 2026-11-05 (China time); execution logs dated 2026-11-04 UTC.

## Fixed package identity

- DSH: exact `@deepseek-ai/dsh@0.2.1-rc.5` and `@deepseek-ai/dsh-web-app@0.2.1-rc.5` from official npm.
- Computer History: CI-assembled `dsh-computer-history-1.1.0.tgz` from main `ff882d5`, Actions run `41758731479`, SHA-256 `0a3988b1af4a338db3a667cb491c8a4b38e0d616ee2573270e45c7c01ba1ebb1`.
- Explicitly allowlisted coexistence packages: `@changfenhuang/dsh-annotation@1.4.11` and `@klarkxy/dsh-dev-index@0.2.7`. These are the exact versions present in the owner's installed manifest. The annotation Node entry is a no-op; the dev-index startup entry registers tools, preset guidance and client handles while its network methods are invoked only by tools. Neither tool was called in these runs.

## Boundary of the exercise

Ran macOS real DSH Web Host and real Chrome with a per-run isolated `DSH_HOME`, DCH history, Chrome user-data-dir and loopback listeners, using a synthetic protocol-only collector. The **main Host phase** also used a disposable `HOME`. The final plugin-uninstall package-manager phase deliberately reused the OS `HOME` to access pnpm's existing content-addressed store (as documented in the standard E2E script); the DSH profile, Chrome and DCH data remained throwaway throughout. This test therefore is **not** a general OS-HOME sandbox for arbitrary plugins. No production DSH profile or its plugin configuration was copied or modified; no actual screen/keyboard capture, external plugin tool calls, real user history or model prompts. The browser side of the co-bundles is real.

Opt-in flags added to the product-journey script only for this test:
`DCH_E2E_COEXIST_ANNOTATION=1` to install the pinned annotation version and verify its real Plugins UI card;
`DCH_E2E_COEXIST_DEV_INDEX=1` to install the pinned dev-index and verify its real Plugins UI card.
These flags do not accept arbitrary package specs; neither is enabled by default.
Run alongside exact `DSH_CLI`, `DSH_WEB_APP_SPEC`, `DSH_PRODUCT_TARBALL`, `DSH_E2E_REGISTRY=https://registry.npmjs.org/`, and disposable-only `DSH_E2E_ALLOW_KOFFI=1`.

## Observed results

| Co-installed packages (besides required DSH web/base) | Result | Local evidence |
|---|---|---|
| DCH + annotation | **58/58 PASS** | `.debug/e2e-product-journey/run-2026-11-04T18-01-17-216Z/checks.json` |
| DCH + annotation + dev-index | **60/60 PASS** | `.debug/e2e-product-journey/run-2026-11-04T18-06-35-395Z/checks.json` |

In both cells, real Chrome displayed Computer History from DSH sidebar; its first-run/capture-policy/Browser Companion privacy matrix, Editor Companion active/save/test events, exact Episode/source linkage, Work Memory and Episode-to-DSH Session Continue binding passed. The DSH plugin-management UI displayed a distinct card for each co-bundle and DCH, and opened the exact DCH detail. Disabling/re-enabling DCH preserved four synthetic observations and the Continue binding; uninstall removed DCH routes/package/bundle while preserving synthetic history. Test-owned Host and Chrome ports were cleanly released.

An initial worktree test failed because the isolated source tree had not generated `extension-editor/out/payload.js`. After the standard `pnpm build:editor-extension`, the full run passed. This was a QA build prerequisite, not a plugin conflict.

## Repeatable PR gate (2026-11-05)

The `Packaged alpha matrix` workflow now includes a **separate `pinned_coexistence` job** on pull requests. It downloads the same CI-assembled three-platform tarball (no build-from-checkout substitution), installs exact DSH CLI/Web Host `0.2.1-rc.5`, builds the Browser/Editor companions and runs the full `pnpm e2e:product-journey` under both `DCH_E2E_COEXIST_ANNOTATION=1` and `DCH_E2E_COEXIST_DEV_INDEX=1`. The flags install only hardcoded reviewed package versions. No `GH_TOKEN`, user profile, private configuration or model request is supplied, and only the redacted `checks.json` test record is uploaded with three-day retention. A CI boundary invariant detects accidental removal of the job.

This is an **ongoing regression gate** for the three-package combination, not evidence of a wider production bundle stack. The new CI job must itself pass on its exact PR commit before its status can be called green.

## Explicit limits / next gates

These two narrow coexistence cells are **not** a blanket multi-plugin guarantee. The annotation editor and dev-index tool invocation flows were not triggered; cross-plugin keyboard focus and all Settings affordances have not been exhaustively inspected. We did not run plugins that may start timers, network clients, notifications, remote bridges or processes (e.g., `dsh-mnemon`, `dsh-context`, `dsh-whale-widget`); no production secrets were available. The other installed external integrations, native Electron UI (#171), production SQLite migration (#172), and broader third-party co-existence (#173) remain separate, still-open gates.

Evidence paths above are local restricted QA artifacts, not checked into Git; this report intentionally contains no profile manifest, auth token, real history or credentials.
