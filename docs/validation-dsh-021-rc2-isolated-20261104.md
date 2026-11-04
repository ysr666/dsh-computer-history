# DSH 0.2.1-rc.2 × Computer History 1.1.0 — isolated packaged-product acceptance

Date: 2026-11-04. Scope: macOS, real DSH Web Host and headless Chrome, completely disposable `DSH_HOME`/`HOME`/Chrome profile; protocol-only synthetic collector. No production profile, history, secrets, collector permissions, or external plugins were changed.

## Exact package and Host

- Product: CI-assembled `dsh-computer-history-1.1.0.tgz`, main commit `ff882d5c8f8f8da0d42eeec4174155bcf5ee0b54`, [Packaged alpha matrix run 41758731479](https://github.com/ysr666/dsh-computer-history/actions/runs/41758731479).
- Package SHA-256: `0a3988b1af4a338db3a667cb491c8a4b38e0d616ee2573270e45c7c01ba1ebb1`.
- Host CLI: `@deepseek-ai/dsh@0.2.1-rc.2`; Web app: `@deepseek-ai/dsh-web-app@0.2.1-rc.2`.
- Test command: `pnpm e2e:product-journey`, with `DSH_CLI`, `DSH_WEB_APP_SPEC`, `DSH_PRODUCT_TARBALL`, official npm `DSH_E2E_REGISTRY`, and `DSH_E2E_ALLOW_KOFFI=1` scoped to the throwaway test profile.
- Result: **56/56 checks passed**, including clean disposal of owned Host and Chrome listeners. Private local test evidence: `.debug/e2e-product-journey/run-2026-11-04T02-30-24-474Z/checks.json` (not a CI artifact and not a production record).

## Verified behavior

Installed real tarball, booted and authenticated DSH Web Host, opened Computer History from the actual Chrome UI, completed first-run consent and checked app-policy defaults. Exercised real Browser Companion (seven privacy matrix cells), Editor Companion installation/bootstrap/active/save/verification observations, one correctly linked multi-source Episode and its citations, Work Memory/Suggestion surfaces, and an exact Episode-to-DSH Session Continue capsule/binding. Disabled and re-enabled the plugin without history loss, then uninstalled and independently confirmed the package, bundle selection, and module disappeared while the four synthetic observations, their provenance and the Continue binding survived.

## Test-harness fixes

- DSH 0.2.1-rc.2's pnpm layout does not always create an `allowBuilds` placeholder for the required `koffi` native install script. E2E now grants **only** `koffi` when `DSH_E2E_ALLOW_KOFFI=1`, under the disposable test profile. Production script approvals are unchanged.
- A login prompt can coexist with the uninstall confirmation. E2E now selects the uninstall-specific dialog rather than the first generic `[role="dialog"]`.
- The local test requires `pnpm build:extension` before its real Chrome Browser Companion matrix. CI compatibility jobs already build that extension.

## Explicit limits

This is **isolated Web Host and Chrome acceptance**, not native Electron keyboard/VoiceOver/window acceptance (#171), not safe production SQLite upgrade approval (#172), and not all configured third-party bundles running together (#173). Adding this exact CLI version to structural preflight's tested list removes only the *unknown-version* blocker; `readiness` still requires separate approval, consistent SQLite backup, maintenance/rollback and co-existence gates. Do not close these Issues based on this report alone. No user history content, token, profile manifest or runtime log has been published here.
