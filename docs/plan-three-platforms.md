# Three platforms, task by task

Master plan for the long-range goal: **macOS, Windows and Linux collectors, and the three
client ends, all honest about what has been verified.** Companion to
`docs/plan-phase2-10.md` (the reasoning); this file is the work: every task has a scope, an
acceptance criterion and a way to verify it.

Rules that apply to every task:

- **No new collection.** ADR 0002 holds everywhere: metadata only, no contents, no keystrokes,
  no screenshots. ADR 0011 governs every companion end.
- **No claim without a live row or an explicit "unverified".** A platform does not work
  because it compiles.
- **Verification is a command.** If a task cannot name the command that proves it, the task is
  not ready.
- **One language for engineering records**; user-facing documents get Chinese.

---

## P1 - the first minute works

### T1.1 Default policy preset
**Scope** `src/host/**`, `presets/**`, tests. Ship a first-run preset that allows the families
people work in (editors, terminals, browsers, file manager) while keeping the built-in
protection for password managers.
**Acceptance** A clean store with the preset applied stores an observation for an allowed
editor and still drops one for a protected application.
**Verify** `pnpm test tests/integration/*preset*` plus a live ingest from a real app.

### T1.2 First run in the panel
**Scope** `src/client/**`. The panel detects a store that has never recorded anything and
shows the first-run path: permission state, the preset with a way to change it, where the
companion token goes, one short page on what is stored and what never is, then "start
recording".
**Acceptance** On a clean store the panel leads to a stored row without the terminal, and the
page never claims more than ADR 0002 allows.
**Verify** `node scripts/panel-shot.mjs` on a clean store, with the row read back from
`/recent`.

### T1.3 One-minute end-to-end proof
**Scope** `docs/validation-*.md`. Record the clean-store → first-row path with its commands
and the row itself.
**Acceptance** The record can be replayed by someone else from the commands alone.
**Verify** Re-run it once on a fresh store.

---

## P2 - the docs a user reads, in Chinese

### T2.1 The user-facing set in Chinese
**Scope** `README.zh.md` (exists), `docs/companion.md`, `docs/editor-companion.md`,
`docs/semantic.md`, `docs/adapters.md`, and the trust page.
**Acceptance** Each has a `*.zh.md` sibling whose content matches the English one.
**Verify** A new check in `pnpm verify`: every user-facing document has a sibling, and the
pair's modification times are within the same change.

### T2.2 The translation check
**Scope** `scripts/verify-docs.mjs`. Refuse a user-facing English document without a Chinese
sibling, and refuse a pair where one is newer than the other by more than one commit.
**Acceptance** Removing a sibling fails the gate; touching only the English one fails too.
**Verify** Calibrated red then green, both directions.

---

## P3 - the update path

### T3.1 Installed versus built
**Scope** `src/host/**`, `src/client/**`. `/state` reports the installed plugin's version and
the built one; the panel says so when they differ and names the command that fixes it.
**Acceptance** With a stale installed copy the panel says it is stale; with a current one it
says nothing.
**Verify** Two live runs, one per state, with the JSON captured.

### T3.2 The remote half, when distribution is allowed
**Scope** the same surface. Not started; the plan keeps the placeholder so the surface is not
mistaken for complete.

---

## P4 - the contract and the suite (the ruler for P5 and P6)

### T4.1 The collector protocol as an artifact
**Scope** `docs/collector-protocol.md`, `src/host/collector/**`. Document the line protocol
(messages, ordering, shutdown, error cases) as the contract a collector must satisfy.
**Acceptance** The macOS collector's behaviour is described exactly, with no behaviour that
the document does not mention.
**Verify** A test that starts the built collector and asserts each documented message.

### T4.2 The conformance suite
**Scope** `tests/conformance/**`, `scripts/verify-collector.mjs`. Protocol conformance,
boundary conformance, and fixtures: recorded platform event streams (AX, UIA, AT-SPI) that
each collector must turn into the same observations.
**Acceptance** The macOS collector passes; a deliberately broken collector (dropping the
messaging timeout, or emitting an extra field) fails.
**Verify** Calibrated red then green; the suite runs inside `pnpm verify`.

### T4.3 Identity across platforms
**Scope** `src/host/ingestion/**`, `src/shared/**`. One identity field, filled with each
platform's stable id (bundle id, AppUserModelID, `.desktop` id), with the platform recorded
so the audit can say which one it came from.
**Acceptance** A Windows-style and a Linux-style id both flow through policy, storage and the
panel unchanged; a user's existing rules keep working.
**Verify** Fixture-driven tests plus one live macOS row unchanged.

---

## P5 - Windows (UI Automation)

### T5.1 The Rust collector skeleton
**Scope** `native/windows/**`. A Rust binary speaking the documented protocol, built by
`pnpm build:windows` (cross-compiled or on a runner), passing T4.2 against fixtures.
**Acceptance** `verify-collector` passes with the Windows collector against the UIA fixtures.
**Verify** The same command as T4.2, with `--collector windows`.

### T5.2 UIA observation path
**Scope** `native/windows/**`. Foreground window, process, AppUserModelID, focused element,
document path where available, protected applications dropped.
**Acceptance** A live Windows run produces rows for Notepad, Explorer, Windows Terminal and
VS Code.
**Verify** A live run on a Windows machine (owner's, or CI with a real Host per scenario and
ports derived from the scenario id).

### T5.3 The panel on a Windows store
**Scope** none (proving, not building). Point the panel at a Windows store.
**Acceptance** A screenshot of the panel showing Windows rows, taken with
`scripts/panel-shot.mjs`.
**Verify** The screenshot plus the rows from `/recent`.

---

## P6 - Linux (AT-SPI2)

### T6.1 AT-SPI backend
**Scope** `native/linux/**`. The same protocol, AT-SPI over D-Bus, with the "accessibility is
off" case reporting a reason rather than silence.
**Acceptance** `verify-collector` passes against the AT-SPI fixtures; the disabled-accessibility
fixture produces a diagnostic, not an empty stream.
**Verify** The suite, plus a live run on a Linux desktop.

### T6.2 The panel on a Linux store
Same shape as T5.3.

---

## P7 - the third end

### T7.1 JetBrains client
**Scope** a new client implementing the documented protocol. No host change.
**Acceptance** A live JetBrains run stores a row whose identity came from the client's own
declaration.
**Verify** The live row plus the client's own log.

### T7.2 A second browser host
**Scope** the browser extension for another engine. No host change.
**Acceptance** A live run stores a row with the same fields as the Chrome one.
**Verify** The live row.

---

## Order and dependencies

```text
T1.1 → T1.2 → T1.3
T2.1 → T2.2
T3.1            (T3.2 blocked by distribution being allowed)
T4.1 → T4.2 → T4.3
T4.2 → T5.1 → T5.2 → T5.3
T4.2 → T6.1 → T6.2
T4.3 → T7.1, T7.2
```

## What "彻底没问题" means, stated so it can be checked

Three collectors, one conformance suite, all three passing it in CI; a live row from macOS,
Windows and Linux, each with the command that produced it; the panel photographed against a
store from each platform; every refusal reason the same on all three; and a validation file
per phase that keeps the mistakes as well as the results. Nothing in that list depends on this
machine being anything but macOS.
