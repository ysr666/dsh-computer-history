# Phase 2.9 — macOS productisation

Status: Ready to execute (owner: "把 macOS 和插件基础打好，比如 UI，做到产品化")
Boundary: no new collection capability. This phase makes what exists usable by
someone who did not build it.

## What "productised" means here, as things to check

1. **A new person can get it working without reading source.** Today they cannot:
   the browser and editor companions need a token copied into settings by hand,
   and when it is missing the companion simply says nothing.
2. **The product says whether it is working.** Right now an empty timeline is
   ambiguous: nothing happened, or collection is broken, or permission was never
   granted, or the collector is not running. All four look the same.
3. **Permissions are asked for, explained and checked** - Accessibility on macOS
   is mandatory for the collector and its absence is invisible today.
4. **It survives the ordinary life of a Mac**: sleep and wake, screen lock,
   display changes, an app that never responds, a store that grows.
5. **It can be installed and removed cleanly**, and the install path is verified
   rather than documented as intended.

## Exit gate

- `pnpm verify` and `pnpm verify:p1` green, with any new invariant check inside
  the gate and calibrated red then green.
- A written walkthrough of a first run on a clean store, with the gaps it found,
  all either fixed or explicitly deferred with a reason.
- The panel answers "is this working?" in one glance: collector state,
  permission state, last observation, companion pairing state.
- Granting and revoking a companion is possible from the panel, not by editing
  settings by hand.
- Screen lock and sleep do not produce false activity, and the store's growth is
  bounded by the retention settings that already exist.
- No behaviour change to what may be collected: ADR 0002 and 0011 untouched.

---

## T2.9-0 — walk through it as a new user

Clean store, no token, no allow rules, nothing loaded: install, look at the panel,
try to get a first row. Write down every place that requires knowledge that is not
in the product, and every state that is indistinguishable from a broken one. The
output is the ordered backlog for the rest of the phase - not a guess about what a
user needs.

## T2.9-1 — one glance: is it working?

`/state` and the panel gain the facts that answer it: whether the collector is
running and since when, whether Accessibility is granted, the newest observation's
age, how many observations the policy refused, and whether a companion is paired.
Empty and broken stop looking identical.

## T2.9-2 — pairing without editing files

Grant a companion (browser, editor) from the panel: show the token once, copy
button, per-client revoke, and a clear statement of what that client may send. The
hand-editing path stays supported and documented.

## T2.9-3 — the macOS life cycle

Screen locked, machine asleep, display changed: activity that was not the user's is
not recorded, and the collector resumes without a false burst. Each case gets a test
or a recorded observation, whichever is honest.

## T2.9-4 — install and removal

One documented, **verified** install path for macOS (plugin plus native collector),
and a removal path that leaves nothing behind but the history the user chose to
keep. `docs/release.md` stops carrying an unverified step for the platform we ship.

## Out of scope

Windows and Linux collectors, another editor platform, and any new thing that may be
collected - this phase is about the experience of the thing that already exists.
