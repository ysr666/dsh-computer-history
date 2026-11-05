# Issue #171 — native Electron compact History header clearance

Date: 2026-11-06 (Asia/Shanghai). Tester: owner-authorized macOS Accessibility native interaction, observed screenshots from isolated QA Electron process.

## Environment and isolation

- Actual Electron Desktop/Host: DeepSeek Harness **0.2.2-rc.1** (Mac auto-upgraded; these results are **not** the prior RC5 test).
- Computer History: **1.1.0**; rebuilt candidate from this PR's branch and installed and enabled through the **official Electron plugin manager**, not by modifying any production plugin manifest.
- Completely separate `HOME`, `DSH_HOME` and Electron `--user-data-dir`; empty synthetic-only SQLite (0 observations and 0 Episodes), no model API key; capture not authorized.
- Owner's daily `desktop` profile, its original `0.1.0-dev.0` Computer History and real history database were left untouched.

## Previously failing, now passed

| Native outer window width | Baseline | Patched | Evidence |
| --- | --- | --- | --- |
| 600 CSS px | History heading overlapped macOS traffic lights | Header clears controls; primary UI remains legible | [before](before-600.png) · [after](after-600.png) |
| 520 CSS px | History heading overlapped macOS traffic lights | Header clears controls; primary UI remains legible | [before](before-520.png) · [after](after-520.png) |
| Requested 420 CSS px | Electron clamps outer window width to **520** | Cannot claim a true 420px native window test | Not applicable |

The patch changes only History page `.ch-main` compact-width top padding from `22px` to `64px`, leaving wide-screen styles and Settings layout unmodified. A unit assertion guards the minimum compact inset. Screenshots show only the empty/synthetic first-run page and do not contain owner history.

## Code checks

- Focused UI regression suite: **5/5 pass**.
- Full `pnpm verify`: **947 pass, 2 skipped**, including privacy, architecture, migration and collector-contract checks.
- `pnpm build` / `pnpm typecheck` after build: PASS. Isolated candidate package built with the companion resources.

## Explicitly not completed by this evidence

This visual clearance fix does **not** complete Issue #171. Native screen-reader names/state, keyboard focus, bilingual English/Chinese layout, populated synthetic Episode exact-ID Continue (including duplicate/mismatched cases), controlled Host disconnect/reconnect and all other native acceptance gates still need separate observed results. Do not call this a release or production upgrade acceptance.
