# Phase 2.10 - Three platforms, and the ends that talk to them

Owner's direction: no doctor, no distribution. Plan the next work, **including three-platform
adaptation**.

Assumption stated: "three ends" is read two ways here, and both are planned - the **collector
platforms** (macOS, Windows, Linux) and the **client ends** (desktop panel, browser companion,
editor companion). Where the two readings imply different work, they are separate sections.

## What the architecture already gives us

The collector is already a separate program that speaks a line protocol on stdin/stdout
(`configured`, `observation`, `diagnostic`, …), and everything above it is platform-neutral:
normalisation and policy, the store and its migrations, the API, the panel, the companion
protocol, the semantic layer. That is the whole reason three platforms is a tractable
proposal rather than three products.

So the platform work is: **keep one contract, add implementations, and prove each
implementation against the same suite.** Two things are *not* platform-neutral today and have
to be decided before code:

### Decision 1 - the application identity

The policy, the adapter table and the audit are all keyed by `bundleId`, which is a macOS
idea. Windows has AppUserModelID (or the executable path), Linux has the `.desktop` id or
WM_CLASS. Two options:

- **(a) keep one field, fill it with each platform's stable application id.** Minimal: no
  migration, no new concept, the UI keeps saying "应用".
- (b) add a neutral `appId` plus a `platform` discriminator. Cleaner in theory, a migration
  plus a rewrite of the adapter table and the policy rules in practice.

**Recommendation: (a).** A stable per-platform id *is* the identity; a second field would buy
nothing a user can see, and every policy rule a user has written would have to be rewritten.

### Decision 2 - the collector conformance suite

Three collectors must not mean three unverifiable codebases. The suite is the contract:

- **protocol conformance**: a collector starts, reports `configured`, emits observations that
  validate against the shared shape, and dies cleanly on shutdown;
- **boundary conformance**: no field exists for contents, selections, keystrokes; unknown
  fields are refused; a protected application is dropped; the policy decides;
- **fixtures per platform**: recorded platform event streams (an AX snapshot, a UIA tree, an
  AT-SPI tree) that each collector must turn into the *same* observations. This is what makes
  Windows and Linux work testable from this machine.

**A collector that passes the suite is a collector this host accepts.** That sentence is the
deliverable of the first phase.

## Phases

### P1 - the first minute works (onboarding + a default policy preset)

Today a fresh install records **nothing**: the default policy is `include-only` with only
protect rules, so the timeline stays empty and the panel has to explain why. That is honest
and it is also a wall. This phase removes the wall without weakening the boundary.

- **A default preset** (the pattern DVR uses for `presets/`): allow the families a person
  actually works in - editors, terminals, browsers, the file manager - and keep the built-in
  protection for password managers. Metadata only; ADR 0002 is untouched.
- **A first run in the panel**: the permission state, the preset with a way to change it,
  where to paste the companion token, and one short page saying what is stored, where, for how
  long and what is never stored. Then a "start recording" confirmation, after which the
  timeline is expected to fill.

*Acceptance, on a clean store, without editing a single file*: open the panel, accept the
preset, work for a minute in an allowed application, and see a row with the application, the
file and the duration. **That end-to-end path is the phase.** Nothing about it may need the
terminal.

### P2 - the docs a user reads, in Chinese

The interface is Chinese now and the docs are not, which is the same mistake the panel had an
hour ago. The rule this phase adopts: **anything a user reads has a Chinese version; anything
an engineer reads stays in one language.**

- Chinese versions of the user-facing set: `README.zh.md` (exists), the companion guides
  (`docs/companion.md`, `docs/editor-companion.md`), the semantic layer explanation, the
  adapters table, the trust page.
- English stays as the source of truth for ADRs, phase plans and validation files - they are
  engineering records, and keeping one language there is a feature, not a gap.
- A check, in the style of this repository: every user-facing document must have a `*.zh.md`
  sibling, and the pair must have been modified together since the last change to either. A
  translation that quietly falls behind is worse than none.

### P3 - the update path, without distribution

An update path is needed even before anything is published, because the installed copy and
the built copy drift silently today - five of the last ten phases ended with "restart the Host
to pick up the new build", which a user cannot be asked to do.

- **P3a, local**: the panel and `/state` know the version of the installed plugin and the
  version of the built one, and say when they differ, with the one command that fixes it
  (`dsh plugin --profile <id> install`).
- **P3b, remote**: the same surface reads a published version when distribution is back on the
  table. Not now, and the plan says so rather than pretending the surface is complete.

### P4 - the contract, and macOS proven against it

Move the protocol and the conformance suite into the repository as first-class artifacts, and
make the existing Swift collector pass them in CI. No new platform yet: this phase exists so
that P5 and P6 have something to be measured by.

*Acceptance*: `pnpm verify` runs the conformance suite against the built macOS collector;
fixtures cover an editor, a terminal, a browser and a protected application; the refusal
reasons match across platforms.

### P5 - Windows (UI Automation)

### P6 - Linux (AT-SPI2 over D-Bus)

### P7 - the third end, honestly

*Acceptance*: the conformance suite passes; a live run on a Windows machine produces rows for Notepad, Explorer, Windows Terminal and VS Code; protected applications are dropped; everything above the collector is unchanged (one binary swapped).

A new collector in **Rust** (`windows` crate: UIA client, `GetForegroundWindow`,
`QueryFullProcessImageName`, AppUserModelID). Rust rather than Swift or C# because both
remaining platforms need the same shape and Rust has mature crates for UIA *and* AT-SPI,
while C#'s AT-SPI story is awkward and Swift's Windows story is worse.

*Acceptance*: the conformance suite passes; a live run on a Windows machine produces rows for
Notepad, Explorer, Windows Terminal and VS Code; protected applications are dropped;
everything above the collector is unchanged (one binary swapped).



The same Rust collector with an AT-SPI backend (`atspi` crate), plus the accessibility bus
detail: on many distributions AT-SPI is disabled until `gsettings set
org.gnome.desktop.interface toolkit-accessibility true`.

*Acceptance*: same suite; a live run on a Linux desktop (GNOME or KDE) produces rows for a
terminal, a file manager and VS Code; the "accessibility is off" case reports a reason
instead of silence.



The browser and editor companions already exist; what "three ends" adds is that they should
not be macOS-shaped either:

- the **editor companion** already declares its own identity (ADR 0011) and speaks a
  documented protocol, so a JetBrains client is a client, not a host change;
- the **browser companion** is a Chrome extension; Firefox and Safari mean a second
  extension host, not a host change;
- the **panel** needs nothing platform-specific, which is worth proving rather than assuming:
  P1 and P2 each end by pointing the panel at a Windows and a Linux store and taking a
  screenshot.


## Verification, given this machine is macOS

- **Conformance suite** - runs everywhere, including here, against fixtures.
- **Live runs** - need the actual machines. Windows: the owner's machine or the CI runner
  pattern DVR already uses (a real Host per scenario, sharded, ports derived from the
  scenario id rather than "19387 must be free"). Linux: a VM or CI container with a virtual
  display.
- **What I will not claim**: that a platform works because its code compiles. Every phase ends
  with a live row and the command that produced it, or it says "unverified" in those words.

## Non-goals

Doctor commands and distribution are explicitly out (owner's call). No new collection: ADR
0002 holds on every platform - metadata only, no contents, no keystrokes, no screenshots -
and ADR 0011's identity claim rules apply to every companion end.

## The order I would run it

**P1 first** (a fresh install that records nothing is the largest gap a user meets), then
**P2** (the docs in the language of the interface), then **P3** (the installed copy stops
drifting silently), then **P4** (the contract and the suite, which is cheap and makes the
platform work measurable), then **P5 Windows**, **P6 Linux**, **P7**.

Three of these were in my own gap list and missing from the first draft of this plan -
onboarding, Chinese docs and the update path. They are recorded here rather than quietly
added, because a plan that skips its own findings is the same failure as a test that proves
nothing.
