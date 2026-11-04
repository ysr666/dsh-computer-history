# Isolated RC5 coexistence acceptance: Computer History + annotation

Date: 2026-11-05 (China Standard Time); execution UTC 2026-11-04.

## Exact packages and environment

- DSH CLI/Web Host: `@deepseek-ai/dsh@0.2.1-rc.5` + `@deepseek-ai/dsh-web-app@0.2.1-rc.5` (official npm).
- Computer History: CI-assembled `dsh-computer-history-1.1.0.tgz`, main commit `ff882d5`, CI run `41758731479`, verified SHA-256 `0a3988b1af4a338db3a667cb491c8a4b38e0d616ee2573270e45c7c01ba1ebb1`.
- External co-bundle: `@changfenhuang/dsh-annotation@1.4.11`. Its shipped Node entry exports a no-op `apply`; browser client is loaded from the published package. This code review is scoped to this exact version.
- macOS, real DSH Web Host and Chrome, fresh per-run `HOME`, `DSH_HOME`, Chrome profile, loopback Host, synthetic collector only. No real profile, secrets, historical records or native capture permissions.
- Invocation: `DCH_E2E_COEXIST_ANNOTATION=1`, `DSH_CLI=/path/to/isolated/0.2.1-rc.5/dsh`, `DSH_WEB_APP_SPEC=@deepseek-ai/dsh-web-app@0.2.1-rc.5`, `DSH_E2E_REGISTRY=https://registry.npmjs.org/`, `DSH_E2E_ALLOW_KOFFI=1`, `DSH_PRODUCT_TARBALL=/path/to/reviewed/CI/artifact.tgz` with `pnpm e2e:product-journey`.

## Actual result — PASS, 58/58

Host installation and authenticated Chrome startup succeeded with both plugins mounted. Real DSH Plugins UI showed both **separate package cards**. DCH first-run, Browser Companion 7-cell privacy matrix, Editor Companion active/save/verification ingestion, exact four-observation Episode/provenance, Work Memory and exact Episode-to-DSH Session Continue binding all passed. DCH plugin detail and disable/re-enable worked while annotation was present. DCH uninstall removed its package/bundle/routes and preserved the four synthetic observations, Episode/citations and Continue binding. All test-owned listeners and Chrome/Host processes were cleaned up. Private local evidence: `.debug/e2e-product-journey/run-2026-11-04T18-01-17-216Z/checks.json` (not committed).

The one initial failed attempt was missing the **Editor Companion build artifact in a newly created worktree**; `pnpm build:editor-extension` generated it. The full second run passed. That first initialization error was not an observed cross-plugin conflict.

## Scope limitations

This proves only one specifically allowlisted browser-side co-bundle, not all the owner's configured third-party plugins, and not native Electron. No actual annotation editing flow, focus-order test across annotation forms, network-enabled integrations, model prompts, scheduling, credentials or production migration were tested. The safety review on other installed package entry points was heuristic and does not authorize mounting them automatically. Issue #173 remains OPEN for the full approved matrix. Issues #171 and #172 remain independently gated.

The optional coexistence flag is **strictly opt-in** and pins one published package; arbitrary package execution is intentionally not accepted.
