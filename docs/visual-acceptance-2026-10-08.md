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

## Settings dialog: separate real packaged-client acceptance

The DCH section of the DSH-native Settings modal was reached by opening
the actual Settings UI and selecting the **Computer History** plugin, with
ten plugin settings rows verified. The new opt-in DCH_SETTINGS_MATRIX=1
mode captured each language in light/dark at 1500, 960, 640 and 420px.

At 420px, the DSH modal's own settings navigation reserves substantial
horizontal space, leaving about **131px** for the plugin section. Before
the DCH-specific responsive fix, the section overflowed its content
column by **83px** and labels wrapped one character per line. The fix
stacks value/actions beneath each row's icon+copy at 480px and below,
without hiding or modifying any host settings navigation. Measured
plugin list horizontal overflow is now **0px in both themes and both
languages**, with no offscreen dialog. Visual screenshots were inspected,
and an actual sequence of keyboard **Tab** input events reached an
enabled DCH Settings button (seventh stop in the isolated test).

The narrow Host Settings navigation still takes a significant share
of the screen; this is a host-level density limitation, **not a claim
that the entire DSH Settings modal is ideal at 420px**.

    DCH_SETTINGS_MATRIX=1 DSH_CLI=/path/to/dsh-0.2-cli pnpm e2e:product-journey
    DCH_SETTINGS_MATRIX=1 DCH_VISUAL_LANG=en-US DSH_CLI=/path/to/dsh-0.2-cli pnpm e2e:product-journey

These checks are opt-in; production Release CI's standard acceptance
remains unchanged. The current run also verified the 52-check packaged
product workflow in Chinese; both Settings locale matrices reached the
real plugin rows and produced 8 snapshots each.

## Remaining Issue #140 scope

A separate fail-to-read **Settings error state** rendered-state run can
supplement this visual evidence. Existing repository tests cover the
loading/error modes and keyboard behavior, but a headless synthetic
collector does **not** prove real OS Accessibility collection. Issue #140
should remain open pending the final error-state review and approval.
