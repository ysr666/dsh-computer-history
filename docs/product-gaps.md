# What is missing between this project and a product

Measured against `dsh-vision-router` (DVR, version 2.3.0), because it is the one plugin in
this ecosystem that a stranger can install, use, update and debug without its author.

## What both have

CHANGELOG, LICENSE, CONTRIBUTING, SECURITY, README in English and Chinese, versioned
packaging, an ADR habit, a test suite that runs in CI.

## Where DVR is ahead, as artifacts

| DVR has | this project | why it matters to a stranger |
|---|---|---|
| `version: 2.3.0`, `docs/releases/` | `0.1.0-dev.0`, no release ever cut | "dev" plus no release notes means there is no version to recommend or to roll back to |
| `update-check.md` | nothing | a stranger will not `git pull`; without an update path they run an old build forever |
| `doctor.md` | nothing | this product's failure mode is **silence** - a stranger needs one command that says why nothing is being recorded |
| `assets/` (icon) | nothing | the plugin appears in the list with a generic icon; it does not look like a thing someone made |
| `repository`, 10 `keywords` | neither | not identifiable, not findable, not publishable |
| `quality/`, property/fuzz/stress/adversarial test families | 8 calibrated guards, 324 tests, no fuzz families | breadth of attack, though the guards have a discipline DVR does not (every one must be shown able to fail) |
| `presets/` | nothing | a sensible first-run policy would remove the blank-page problem at the root |
| docs in Chinese (`*.zh-CN.md`) | English only | the interface is now Chinese and the docs are not - the same mistake the panel had |
| published release, installable | tarball install **unverified**, extension not on any marketplace | it cannot be given to anyone |

## Where the real product gaps are, in the order a stranger meets them

Artifacts are the easy half. These are the ones that decide whether a person who did not
build this can use it:

1. **Onboarding.** A stranger must grant Accessibility, choose which applications may be
   recorded, and pair a companion. The panel now *says* what to do, but there is no first
   run that walks through it, and no sensible default policy - so the honest first
   impression is an empty timeline and four paragraphs.
2. **A doctor.** The product can now report "nothing is allowed yet" and "no client has ever
   used the token". That knowledge is in a panel a stranger may not open. `dsh computer-history
   doctor` printing the same facts to a terminal is the difference between a support thread
   and a self-service fix.
3. **An update path.** Five of the ten phases so far ended with "restart the Host to pick up
   the new build". A user cannot be asked to do that.
4. **Distribution.** A signed, notarised native collector, a real install, and an editor
   extension a person can install from their editor. Until then the product only exists on
   this machine.
5. **The trust page.** The boundary is in ADRs and in `SECURITY.md`; a user needs one page
   in the product that says what is stored, where, for how long, and what is never stored -
   with the reassurance that the answer is short.
6. **Docs in the language of the interface.** The UI work made this obvious: a Chinese user
   reading English docs is the same failure the panel had an hour ago.

## What this project has that DVR's checklist cannot see

Worth writing down so it does not get thrown away while chasing parity:

- **calibration as a rule**: every guard must be demonstrably able to fail, and the phase
  reports keep the ones that were wrong;
- **an explicit boundary** (ADR 0002) with the refusals recorded by reason, which is what
  makes "why is my timeline empty" answerable at all;
- **validation files per phase** with the commands, the numbers, and the mistakes.

## If I were choosing, in this order

1. **doctor** (small, uses what already exists, kills the silence),
2. **onboarding + default policy preset** (turns a blank page into a working first minute),
3. **update path**,
4. **docs in Chinese**,
5. **distribution: icon, release, notarised collector, extension install**.
