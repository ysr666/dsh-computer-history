# DCH v1.1 — isolated DSH Web Host UI acceptance (2026-10-10)

**Scope:** real DSH `0.2.0-rc.2` **Web Host** and its shipped browser
client, running the *candidate* `dsh-computer-history` bundle. This is
**not an Electron Desktop installed-plugin acceptance** and does not validate
a live-provider Find → Answer → Continue chain.

## Safety prerequisites

1. Use a new, private test directory, unrelated to the current DSH profile,
   session store, history database, and worktree. Set **both** `HOME` and
   `DSH_HOME` to isolated directories for every launcher invocation. Do not
   reuse production `.credentials.yaml`, DSH profile patches, or browser
   profile.
2. Make the test profile's *only* bundles
   `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and the candidate
   `dsh-computer-history`. Link installed dependencies read-only in the new
   profile's *own* node_modules; never create new files in existing profiles.
3. Override the candidate's plugin configuration to `enabled: false`.
   Before running anything, use `dsh --profile <test-profile> --dump-config`
   to verify the DCH bundle is present, `enabled: false` wins, and no
   production history directory or credentials occur in the composed config.
4. Start only with `--no-open --host 127.0.0.1 --port 0`. Keep the startup
   URL/token private. Open in a disposable browser profile, not a logged-in
   browser. Dismiss preview and API-key onboarding using the "later" options;
   never connect a model or grant capture/accessibility permissions.
5. Do **not** click Start/Authorize, enable recording, change allowlists,
   import, export private data, delete history, or send a model prompt during
   this smoke test. The lack of real evidence is intentional.
6. At completion terminate only the test-scoped Host and Chrome processes;
   remove their isolated authentication token log and browser cookies.
   Keep only sanitized results and test screenshots.

## Actual observed DSH Web Host test

Executed against a clean isolated profile on 2026-10-10. Browser access and
clicks used DevTools Protocol; not mocks, user profile automation or React
hook stubs.

| Scenario | Observed result |
|---|---|
| Compose config with candidate bundle, capture disabled, no real-home references | PASS |
| DSH Web Host runs on loopback with separate HOME and DSH_HOME | PASS |
| Browser renders native DSH home with a Computer History sidebar entry | PASS |
| Click Computer History and show the first-run History page | PASS |
| Expand Ask Your History; both AI composer and local search entries render | PASS |
| Paste nonexistent Episode ID and click source inspection | PASS — warning visible; no Continue action |
| Enter synthetic phrase into local search | PASS — explicitly no retained evidence; no fabricated Continue |
| Open DSH Settings then Computer History settings page | PASS |
| Disabled collection shown as unavailable, 0 apps allowed, 30-day retention | PASS |
| Source page at viewport widths 420, 600, 1180px | PASS — no page/panel overflow |
| DCH Settings at viewport widths 420, 600, 1180px | PASS — no overflowing visible DCH settings elements |
| Full installed **Electron** Desktop instance | NOT TESTED |
| Real-model source answer followed by real-file Continue | NOT TESTED (privacy/authorization gate) |

**UX caveat:** At 420px window width, the DSH Settings modal allocates only
approximately **131px** to the plugin Settings column. Content is legible but
very vertically stacked. Neither the plugin's setting rows nor the overall
page overflow, but this is a Host-layout product constraint. Do not patch
global DSH styles from within the plugin to disguise it.

**Onboarding caveat:** A new DSH Web profile displays the standard preview
notice and a no-key model onboarding modal. Those are Host dialogs, not DCH
rendering failures. Close them in the isolated profile before taking a UI
screenshot. The model is neither connected nor used by this test.

## Remaining release gates

- Verify installation in a **separate, permitted Electron Desktop test
  profile**, including actual client lifecycle and local hardware/platform
  capabilities; do not try to use `DeepSeek Harness --help` to inspect CLI
  flags because this executable launches the real desktop process.
- Using fully synthetic history, verify actual DSH model answer grounding and
  the human-reviewed exact Episode → Continue handoff, with no access to
  generic shell/file tools.
- Review keyboard focus, language switching, Settings navigation and status
  on both macOS and Windows, with measured screenshots.
- Keep original dirty user worktrees untouched, and do not commit, push or
  release on the basis of this Web Host smoke test.
