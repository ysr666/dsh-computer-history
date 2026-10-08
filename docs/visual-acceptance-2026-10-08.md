# Computer History visual acceptance — 2026-10-08

This review used **real browser renders of the installable Computer History
v1.0.0 release candidate** inside an isolated **DeepSeek Harness 0.2.0-rc.2
Host/profile**. The product journey provided a synthetic, protocol-only
collector. These screenshots are not design mockups or live user history.

## Visual matrix

| State | UI language | System color preference | Window widths | Checked |
| --- | --- | --- | --- | --- |
| First-run consent | English, Simplified Chinese | light, dark | 1500, 960, 640, 420 px | 16/16; no overflow, CTA clipping or wrapping |
| Continue / Timeline / Work threads | English, Simplified Chinese | light, dark | 1500, 960, 640, 420 px | 16/16; no overflow; Continue button present |

Chromium CDP emulated viewport width and system color preference. The
**computed text colors actually changed** across light/dark modes; the
English Host page genuinely rendered English UI strings after the
en-US locale override. This was not an image translation. Both language
runs completed the **52-check install-to-Continue product journey**.
Release CI is unaffected because these extra matrix captures are opt-in.

Reproduce from a checkout with a DSH 0.2.0-rc.2 CLI:

    DCH_VISUAL_MATRIX=1 DSH_CLI=/path/to/dsh-0.2-cli pnpm e2e:product-journey
    DCH_VISUAL_MATRIX=1 DCH_VISUAL_LANG=en-US DSH_CLI=/path/to/dsh-0.2-cli pnpm e2e:product-journey

Each run writes matrix screenshots and JSON measurements to its private,
gitignored .debug/e2e-product-journey/run-* directory. The script restores
the normal viewport and system preference before the original product checks
resume.

## Public README image provenance and privacy

The four images are **actual packaged-client Chrome captures**:

- docs/assets/panel-v1-first-run-en.png
- docs/assets/panel-v1-recent-work-en.png
- docs/assets/panel-v1-first-run-zh.png
- docs/assets/panel-v1-recent-work-zh.png

First-run images are unchanged. For each populated Timeline screenshot
**only the synthetic fixture URL on the Work threads secondary resource
line** was masked and replaced with an explicit
[sample browser URL redacted] label. The original UI controls, layout,
activity evidence, and Continue target are not doctored. No personal
profile, authentication URL, cookies, browser pairing token, or fixture
query token is intended to appear in public assets. Raw screenshots
showing fixture URLs remain private .debug files only.

These images prove UI rendering and workflow; they **do not** establish
live Accessibility collector coverage or a published npm release.

## Remaining Issue #140 acceptance

The plugin's Settings dialog still needs its own real-browser English /
Chinese, light / dark, narrow-width, read-error and keyboard focus visual
review. Issue #140 must remain open until that and final README review pass.
