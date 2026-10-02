# Verification guide

How to verify Computer History against a real Mac, and how not to fool
yourself while doing it. Everything in `scripts/verify/` exists for this page.

## Tools

    pnpm verify:tools                      # builds bin/verify/{ax-probe,activate}
    node scripts/verify/live-probe.mjs --help
    node scripts/verify/fixtures/build-fixture.mjs --bundle <id>
    node scripts/verify/fixtures/build-fixture.mjs --clean

| Tool | Purpose |
|---|---|
| `scripts/verify/live-probe.mjs` | Runs the real collector binary over stdio NDJSON and logs raw observations before any Host filtering. `--allow` / `--protect` set the policy the probe sends. It never opens a history database. |
| `scripts/verify/ax-probe.swift` | Dumps the focused-element and focused-window attributes for one PID: read statuses, role, subrole, document, URL, title. This is how the Terminal (F4) and Chromium (F11) defects were found. |
| `scripts/verify/activate.swift` | Brings an application to the front **only when the session has been idle for ≥1.2s**, raising either its first window or one matching `--marker`. `--list` prints windows without touching focus. |
| `scripts/verify/fixtures/` | A synthetic AppKit application (`secure` / `plain` / `hung`) that can claim any Phase 1 bundle id, plus its builder. |

## The four rules

1. **Calibrate a probe on both sides before trusting a negative.** A probe that
   reports "no contention", "nothing captured", or "no leak" is worthless until
   the same probe has been shown to report the opposite when the condition is
   present. Phase 1 produced three false alarms because this step was skipped
   (a missing CLI argument, the lock file passed instead of the filename whose
   `.lock` sibling the library locks, and a first read that folded in the
   previous session's rows).
2. **Partition before comparing.** Observations carry `collector_session`.
   Comparing "rows before" with "rows after" across sessions turns an old row
   into an apparent new leak. Filter by session (or by an explicit time window)
   first.
3. **Prefer a same-input differential.** Change exactly one variable — add the
   protect rule, remove it, switch the window — and keep the fixture, the file,
   and the timing identical. Absolute numbers from different setups prove
   nothing.
4. **Never fight the user for focus.** The collector observes the frontmost
   application. Use `activate.swift` (idle-gated) instead of a plain `open -a`;
   a focus fight produces "no observations" that looks like a product bug.

## Safety rules

- Synthetic fixtures only. Never a real private file, never a real credential.
  The `secure` fixture field is a genuine `NSSecureTextField` and is never
  filled.
- Delete the fixture bundle when the recipe is done
  (`build-fixture.mjs --clean`). It claims a real bundle id, and LaunchServices
  must not end up with two bundles carrying the same identifier.
- The probe writes NDJSON to `/tmp`. Treat those logs as machine evidence, not
  as project files, and keep real paths out of the repo.

## Recipes

### Adapter evidence row (T2.0-2 … T2.0-4)

1. Install or open the application; open a file from a synthetic fixture
   directory (never a real project).
2. `bin/verify/activate --pid <app pid> --budget 45`
3. `node scripts/verify/live-probe.mjs --allow <bundle id> --seconds 15 --log /tmp/adapter.log`
4. `bin/verify/ax-probe <app pid> 2`
5. Record in `docs/adapters.md`: bundle id, surface kind, the AX facts
   (document/URL/title outcomes with raw status codes), the resource outcome,
   the probe command, and the date.

### Secure-field and privacy matrix

1. `node scripts/verify/fixtures/build-fixture.mjs --bundle com.microsoft.VSCode`
2. `bin/fixtures/DSHFixture.app/Contents/MacOS/DSHFixture secure /tmp/fixture.html`
3. Probe with the matching allow list: expect `privacy.secure=true`,
   `reason=secure-field`, and no window/element fields.
4. Repeat with `plain`: expect `secure=false` plus window metadata.
5. Point the host at a one-time data directory, add an allow rule, and confirm
   the secure observation produces **zero** stored rows.
6. `node scripts/verify/fixtures/build-fixture.mjs --clean`

### Timeout / hung application

1. Build the fixture, run it in `hung` mode (blocks the main thread for 6s).
2. Start a pause-ack timer against the helper, or run the probe and measure how
   long the collector stalls.
3. Expect the control queue to answer within roughly one messaging timeout, not
   the freeze duration.
