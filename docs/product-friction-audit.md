# Product friction audit — from developer-usable to product-complete

Date: 2026-10-04

This is a user-journey audit, not a feature wishlist. The question for every row is:

> Is the product asking the user to understand or perform something that the product can safely do itself?

The default rule is: **do not expose IDs, tokens, ports, paths, commands, implementation state, or manual restart steps unless the platform/security boundary makes them unavoidable.** Manual procedures are fallback/diagnostic surfaces, not the primary product flow.

Status vocabulary:

- **AUTO** — product can complete it without a user decision after the user initiates the feature.
- **ONE CLICK** — user consent is inherently required, but the product should take them directly to the authoritative action and automatically finish the rest.
- **MANUAL FALLBACK** — keep only under Advanced/Diagnostics after the normal path exists.
- **NEEDS VERIFICATION** — a DSH/OS/browser capability has not yet been proven; do not invent it.

## Executive priority

| Priority | User moment | Current product | Target product | Class | Primary owner |
|---|---|---|---|---|---|
| P0 | First launch | **Productized:** derived setup state now distinguishes choose-apps / permission / paused / waiting / blocked; choosing apps also resumes a paused collector | Keep one truthful setup state machine through first observation; never declare success from a button click alone | **DONE for current macOS path** | Host + Main |
| P0 | Accessibility permission | **Productized:** `打开系统设置` uses a fixed Host action; returning to DSH re-reads state | Keep the action fixed and platform-verified; unsupported Hosts must fall back honestly | **ONE CLICK — macOS verified 2026-10-04** | Host fixed action + Main |
| P0 | Browser companion install | Developer-mode / Load-unpacked flow is now hidden under **Developer setup**; normal UI no longer exposes path/token/port | `安装浏览器扩展` opens the authoritative store listing; browser owns confirmation; DSH then detects installed/enabled | **BLOCKED by store publication + stable extension ID** | Distribution + Host inventory + Settings |
| P0 | Browser companion pairing | Manual token remains only under Developer setup | Stable store extension ID + reviewed authenticated bridge (Native Messaging or equivalent); no token/port in normal UI; connection automatic after install | **BLOCKED by pairing architecture + distribution** | Distribution + native host + extension |
| P0 | VS Code companion install | **Productized on verified macOS path:** Host installs only the bundled VSIX with fixed argv. It uses `code` when available and falls back to the standard VS Code.app bundled CLI, so the user does not need to configure a shell command. The real POST install path was live-verified on 2026-10-04. | Marketplace distribution can replace bundled VSIX later, but the normal local install no longer requires a terminal or CLI setup | **ONE CLICK + LIVE VERIFIED on macOS** | Host + Settings + package |
| P0 | Editor companion pairing | **Productized on verified macOS/VS Code path:** Host rotates an editor-only credential, stages it in a user-owned `0600` five-minute bootstrap file, and the extension consumes it into VS Code SecretStorage then deletes the cleartext handoff. Installed-but-not-connected can retry with one `Connect automatically` action. Live-verified on 2026-10-04. | Keep credentials out of visible editor settings; future Marketplace distribution must preserve the same authenticated boundary | **AUTO BOOTSTRAP + LIVE VERIFIED** | Host + editor extension |
| P0 | Broken/empty recording | **Mostly productized:** first-run/setup now consumes shared health states and distinguishes choose apps, permission, paused, stopped/degraded and waiting. Choose-apps, permission and paused have real actions | Stopped/degraded still need a proven Host repair/reload action instead of terminal guidance | AUTO diagnosis **DONE**; stopped/degraded repair **NEEDS VERIFIED lifecycle seam** | shared health + Main/Settings |
| P0 | Stale plugin build/update | Default UI now says only that the Host is running an older build; the raw update command is under Manual update details | Update through DSH's supported plugin/update surface; then reload/restart through a proven Host mechanism | **NEEDS VERIFICATION** of DSH update/reload APIs; no matching rc.2 seam proven in current deps | DSH integration + Distribution |
| P1 | Choose participating apps | **Productized on macOS:** Host queries only the fixed supported bundle-id set through Spotlight, returns applications actually installed on this machine, and Settings presents them as a name-based picker. First-run narrows the cross-platform preset with the same verified inventory. Bundle ID remains Advanced fallback only. Live-verified on 2026-10-04. | Add verified platform inventories elsewhere; app icons remain a separate identity polish item | **DONE on verified macOS inventory path** | Host inventory + Settings |
| P1 | Websites/site policy | Settings now honestly says Applications; there is still no website/origin policy manager | Implement explicit website/resource-origin controls only if product wants that control surface | Product decision | Policy + Settings |
| P1 | Companion outage/port conflict | Normal browser row shows product state and last connection; loopback port/path/token are now developer-only | Add Retry/Fix when a safe Host action exists; Native Messaging can remove loopback-port setup entirely | AUTO diagnosis; repair action needs design | Host + Settings |
| P1 | Another Host owns capture/policy | The reason is now translated into product language and explicitly says history remains readable here; the safe recovery is to close the other Host and reopen this Host. | Add direct Host navigation/takeover only if DSH exposes a proven safe seam | **COPY/RECOVERY GUIDANCE DONE; direct navigation NEEDS VERIFICATION** | Host state + UI |
| P1 | Resume target disappeared | **Productized:** after the stored-evidence/scheme checks, local files/workspaces are checked for existence; a missing target gets its own user-facing message. Recorded-app failure already falls back to the system default handler | Keep unsupported platform, missing target and launch failure distinct. Add Reveal/Copy only if a proven safe interaction is needed | **DONE for verified macOS opener path** | Resume opener + Main |
| P1 | Plugin/browser/editor version mismatch | VS Code companion now reads the installed extension version, compares it with the bundled version, shows `Update available`, and updates the Host-owned VSIX with the same fixed `--force` action. Browser/plugin update still depend on production distribution/DSH lifecycle seams. | Extend version compatibility to browser/plugin once those real distribution surfaces exist | **EDITOR DONE; browser/plugin remain blocked** | Distribution + Settings/About |
| P1 | Plugin uninstall | Official rc.2 Plugin Inventory is explicitly read-only and cannot add/remove/enable/disable entries; verified docs remain the current fallback | A real Loader/package-manager mutation seam must own uninstall; explicitly ask whether to keep or delete local history; companions cleaned up separately | **NEEDS VERIFICATION** of a lifecycle mutation surface; do not misuse Plugin Inventory | DSH integration + Distribution |
| P1 | JetBrains companion | Current development setup still uses JVM `computer-history.port/token` properties and is absent from the normal product setup journey | Product install/update surface plus the same reviewed automatic credential bootstrap used by other companions | **BLOCKED by distribution + pairing architecture** | Distribution + JetBrains plugin + Host |
| P2 | Export history | **Productized:** Settings → Data downloads the existing `/export` JSON through the browser download path; copy states that pairing credentials are excluded | Keep export user-initiated and transport-independent | **DONE; real rc.2 Web Host supports standard download APIs** | Client + existing Host API |
| P2 | Import history | **Productized:** Settings → Data chooses a JSON file locally, parses it before upload, shows the file name, then requires explicit confirmation. Host validates schema/tables/columns/values transactionally and merges with `INSERT OR REPLACE`; successful import bumps `historyRevision` | Keep selection and confirmation separate; never imply import clears unrelated existing history | **DONE; browser File input + existing transactional Host import** | Client + existing Host API |
| P2 | Redaction/privacy preview | Host `/audit/preview` exists, no normal Client surface | Privacy inspector answers “what would be excluded?” for an app/project without exposing raw API language | User action | Client + Host existing API |
| P2 | Remote/local summaries | Default Main now shows human scope/provider labels; raw scope/provider/model and payload JSON are behind Technical details. There is still no polished enable/consent flow | Product concepts: Local / Remote summary, what leaves device, preview before enabling, manage per project; technical IDs stay Advanced | Default display **DONE**; consent flow remains | Semantic UI + existing Host API |
| P2 | Trust/privacy understanding | About now states the real boundary, including the explicit remote-summary exception, and diagnostics are separate | Add a compact Trust/Data surface only if it improves discoverability of collected/never-collected/storage/delete/export facts | Read-only | Settings |
| P2 | Retention | **Productized:** 7/30/90/365-day presets are primary; exact raw-observation hours and episode days live under Advanced | Keep presets first without removing exact expert control | **DONE** | Settings |
| P2 | Diagnostics | **Productized:** About → Diagnostics downloads a support-safe JSON report containing runtime health/version/connection facts only. Tests assert it excludes history, resource/path data, ports, pairing credentials and update commands. | Keep the report small and metadata-free; CLI doctor may remain a support fallback | **DONE** | Client + Settings |
| P3 | App identity | Letter glyphs/friendly-name tables are local presentation fixes | Verified platform app identity/icon source with deterministic fallback; no icon scraping hacks | **NEEDS VERIFICATION** | Host identity + Client |
| P3 | Plugin discovery/branding | `private:true`, dev version, generic identity/icon, no production distribution | Real package metadata, icon, release notes, signed/notarized artifacts and supported install source | Release decision required | Distribution |

## What the Codex/ChatGPT browser integration proves locally

On this Mac, the installed official ChatGPT Chrome extension declares `nativeMessaging`. Chrome has a user-level native host manifest named `com.openai.codexextension`; that manifest limits `allowed_origins` to fixed extension IDs and points at a platform-native stdio host. The locally installed Codex Chrome plugin also contains browser inventory, installed/enabled extension detection, store URLs, and cross-platform Native Messaging manifest installation logic.

That is useful precedent, not source to copy. The product lesson is:

**Store-distributed extension + stable extension ID + OS Native Messaging host + installed/enabled diagnostics** is the shape that removes token/port setup from a desktop/browser product.

Our current `Load unpacked + pairing token + localhost port` flow is appropriate for development verification, not the primary consumer path.

## Browser distribution constraint

Chrome's supported normal-user path on macOS and Windows is store distribution; unpacked installation is a developer flow, and self-hosted forced installation is an enterprise-policy path. Therefore “one-click install” must not mean silently installing an unpacked extension. The honest product flow is:

`Install browser extension` → open the authoritative store listing → browser-owned confirmation → automatically detect installed/enabled → automatically establish the desktop bridge.

Until there is a published extension with a stable ID, the existing unpacked flow remains a **Manual development fallback**, not something to cosmetically relabel as one-click.

## Concrete gaps found in the current tree

### First run now has a real setup state machine; recovery is the remaining gap

`setupStage()` derives setup from actual policy/capture/permission/history state, so onboarding no longer disappears merely because a button was clicked. The first action applies the supported-app preset, resumes a paused collector, and on verified macOS now opens the correct Accessibility settings surface immediately when permission is still missing. Returning to DSH re-reads state; the first observed episode is what completes setup.

Remaining gap: `stopped` and `degraded` can be diagnosed truthfully but still have no verified Host repair/reload action. Do not invent one. Browser/editor companions remain optional enhancements, not prerequisites for core setup.

### App removal must not imply data deletion

The normal app-list action now means **stop future recording** only. Existing history is preserved. App-scoped deletion is a separate destructive intent and must stay behind an explicit deletion/confirmation flow; never reintroduce a single “Forget” action that silently changes policy and deletes history together.

### Website policy is still a separate product decision

Settings now honestly calls the row **Applications**. The policy also supports `resource`, and browser URLs become resources, but there is still no normal website/origin policy manager. Do not relabel the app row as “applications and sites” unless a real site-control surface is added.

### Backend capability is not the same as product capability

Export/import now have normal Settings flows, but `/audit/preview` and the semantic opt-in/revoke contract are still only partly productized. Future status documents must distinguish:

1. contract/Host capability exists;
2. Client surface exists;
3. normal-user flow is installed/distributed and live-verified.

A feature is product-complete only at (3).

## Implementation order

### Phase 3A — Setup without developer rituals

1. **DONE on verified macOS path:** derived setup state, one first-run action, fixed Accessibility settings opener, return-to-app recheck, and non-destructive app disable.
2. Browser production path: stable store IDs + installed/enabled inventory + Native Messaging (or an equivalently reviewed authenticated bridge). Keep unpacked/token/port only under Developer setup during migration.
3. **DONE + live-verified on macOS/VS Code:** one-click VSIX install, automatic short-lived credential bootstrap into SecretStorage, retryable automatic reconnect, app-bundle CLI fallback, and bundled-version update detection.
4. **DONE + live-verified on macOS:** installed/supported-app inventory drives the normal picker and narrows first-run; Bundle ID remains Advanced fallback. Other platforms stay unavailable until live-verified.

### Phase 3B — Recovery and lifecycle

1. Multi-host copy now gives the safe reopen recovery. Collector `stopped/degraded` still has **no product repair button**: the current manager can release capture ownership while its crash restart is still scheduled, so expose no restart action until that lifecycle seam is made single-owner and testable.
2. Replace stale-build command snippets with the supported DSH update/reload mechanism once verified.
3. Add version compatibility and installed/enabled state for plugin/browser/editor components.
4. Define uninstall/keep-history/delete-history product flow through the DSH-supported uninstall surface.

### Phase 3C — Data and trust surfaces

1. Export/import UI over the existing Host routes.
2. **Diagnostics DONE:** About can download a support-safe runtime report. Add a larger Trust/Privacy surface only if it improves discoverability beyond the current About copy.
3. Site/resource policy UI or correct the copy if product decides not to expose it.
4. Productize semantic summary consent; hide `scopeKey`/provider implementation language from the default surface.
5. Simplify retention with presets while keeping Advanced exact values.

## Non-goals

This audit does **not** authorize release, marketplace publication, extension IDs, signing identities, version bumps, tags, publishing, or merge-to-main. Those remain explicit user decisions.

It also does not justify weakening the metadata-only boundary. Native Messaging or automatic pairing changes transport/setup only; they must not add page content, DOM reads, document text, selections, keystrokes, clipboard, screenshots, or any new content-bearing field.