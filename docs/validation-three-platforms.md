# Three platforms: what was verified, and what went wrong on the way

One section per phase. Mistakes stay in, because they are the part that is expensive to rediscover.

## P1 - the first minute works

### The preset, applied the way the panel applies it (integration tests)

`tests/integration/preset.spec.ts`, three tests against the real store, the real policy store and
the real ingestion service:

- on a store that has recorded nothing, an allowed editor is refused before the preset and stored
  after it;
- a protected application (1Password) is still refused after the preset, and the refusal is counted
  as `protected-app`;
- an application outside the preset is still refused, and nothing is stored.

### The first-run screen, on a clean store

```bash
npm install --prefix /tmp/dsh-cli-020 @deepseek-ai/dsh@0.2.0-rc.2   # the same version as the app
cp -R ~/.dsh/profiles/web ~/.dsh/profiles/firstrun                   # a profile of my own
dsh plugin --profile firstrun add ./dsh-computer-history-<version>.tgz
# add it to the profile's "bundles", then:
/tmp/dsh-cli-020/node_modules/.bin/dsh --profile firstrun --port 19420 --no-open
```

Evidence: `docs/assets/panel-firstrun-clean-store.png` - the sidebar entry **Computer History**, and a
panel whose first section is 从这里开始: what will be recorded, what never will be, the preset in the
interface's language, and one button (开始记录).

### Eleven rounds lost to a version mismatch, and how it hid

The panel registers `main` and `sidebar.panellist`. Those slots exist in **0.2.0-rc.2** (the app) and
not in **0.1.2-rc.1** (what `dsh` on `PATH` installs). A Host booted from the older CLI has no such
slot, so the registration silently does nothing - and every symptom pointed at the plugin: the client
bundle was in `window.__DSH_BOOT__.entries`, its request returned **200**, no exception was thrown,
and nothing rendered.

Two hypotheses were falsified on the way and are worth keeping: "the interface does not know about
the client half" (it does), and "the vision-router plugin is a valid control" (it registers different
slots, so it was not).

**The rule that would have saved the eleven rounds: check the Host's version against the interface's
before concluding anything about the plugin.**

### The first minute, end to end, without a terminal

Done on a store that had never recorded anything, through the interface only:

1. open the panel (`Computer History` in the sidebar) - the first section is 从这里开始;
2. press **开始记录** - the panel applies the preset through `/policy`;
3. work for about a minute in an allowed application;
4. the timeline has a row.

Measured either side of step 2:

```text
policy before   only built-in rules (protection), nothing allowed
policy after    34 rules, 22 of them allow
first-run       the 从这里开始 section disappears, because a user rule now exists
/recent         [] before the minute, one episode after it
episode         Applications: com.apple.Terminal   resource: file:///Users/ysradmin (directory)
summary         "Recent computer activity. Observed resources: - ysradmin Applications: com.apple.Terminal"
```

Evidence: `docs/assets/panel-first-row.png`.

**Honest about the quality of that first row**, because "a row appeared" is not the same as "useful":

- the resource is the terminal's **working directory**, not a file - a terminal has no document, so a
  file needs an editor in the foreground;
- the duration is **0 ms**: one sample, because the observation arrived at the edge of the wait. The
  acceptance says "work for a minute", and a minute of *sampling* is what produces a duration;
- the earlier attempt produced nothing at all, and the reason is worth keeping: the collector records
  the **frontmost** application, and `open -a Finder` moved no focus, so the machine appeared idle.
  The refusal breakdown was empty, which is correct - nothing had been refused, nothing had arrived.

So P1's third item is **met in the narrow sense** (the path works and a row appears without touching
the terminal) and **not yet met in the useful sense** (an application, a file, and a duration). The
next pass should repeat it with an editor in the foreground for longer, and if the row is still
0 ms, look at the sampling interval rather than at the panel.

### Why the duration is zero, and it is not the panel

Repeated with an editor in the foreground for 150 seconds. The row became useful - a **file**
resource, and a summary naming both:

```text
resource  file  .../dsh-computer-history/docs/ui-review.md
summary   Worked in dsh-computer-history. Observed resources: - ui-review.md
          Applications: com.microsoft.VSCode
duration  0 ms
```

The duration is still zero, and the reason is in the collector rather than the interface: the
heartbeat timer fires every interval and calls `reconcileFrontmost()`, but observations are
deduplicated by a fingerprint - **an unchanged state does not produce a new observation**. Sitting in
one file for two and a half minutes therefore produces exactly one observation, an episode with a
single sample, and a duration of zero.

Two ways to fix it, and they are not equivalent:

1. **the episode side** (preferred): while an episode is open, its end should track "now" rather than
   the last observation's timestamp, so a dwell that is still happening has a duration. This changes
   nothing about what is collected and nothing about the collector's cadence - the data already
   supports it.
2. **the collector side**: emit a heartbeat observation even when nothing changed, which trades
   storage for continuity and adds a cadence to keep in step across three platforms. It also makes
   "the machine was idle" indistinguishable from "nothing changed" unless the two are distinguished
   explicitly.

The next pass takes (1) and re-runs this measurement; if the duration is still zero, the assumption
to attack is that the episode ever sees a second sample.

### What a duration means when sampling is change-driven

`src/host/episodes/builder.ts` closes an episode after 480 s of quiet with
`emit(this.active, 'timeout', false)`, and the emitted end is the last included timestamp. With one
observation - which is all an unchanged state produces - the duration is exactly zero. The number is
not wrong by accident; it is the honest answer to "how long did we *see* this", and the sampling
model means we see a state once.

Three ways to make it mean "how long did this last", with what each costs:

1. **floor the duration at the collector's heartbeat interval.** We already know the state held for
   at least one interval after the last observation, so a floor is knowledge we have, not a guess.
   Cost: the host needs that interval, which means the collector declares it over the existing
   protocol - one field, and the same field is needed on all three platforms for the durations to be
   comparable.
2. **let the end track "now" while the episode is open.** No protocol change, and it is right for a
   dwell that is still happening - but for the episode above it would report the 480 s quiet period,
   which overstates a ten-second look at a file.
3. **emit heartbeat observations even when nothing changed.** Simple to reason about and the number
   becomes true, but it trades storage for continuity, adds a cadence to keep in step across three
   platforms, and makes an idle machine indistinguishable from an unchanged one unless the two are
   distinguished explicitly.

**Recommendation: (1).** It uses what is already known, it needs one field rather than a new cadence,
and that field is exactly what a three-platform build needs anyway so the three can be compared
honestly.

### The duration floor: the four places it touches

Located, so the implementation is mechanical rather than exploratory:

| place | file | what changes |
|---|---|---|
| the interval itself | `native/macos/Sources/ComputerHistoryCollector/Collector.swift:6` | `private let heartbeatInterval: TimeInterval = 5` becomes visible to the message builder |
| the message | `native/macos/Sources/ComputerHistoryCollector/Protocol.swift:15-17` | `Configured` gains `heartbeatSeconds` |
| the parser | `src/host/collector/protocol.ts:383` (`case 'configured'`) and the type at `src/shared/protocol.ts:82` | accept and carry the field |
| the floor | `src/host/episodes/builder.ts:426` (`emit(this.active, 'timeout', false)`) | an episode closed by quiet ends at `max(lastIncludedAtMs, lastIncludedAtMs + heartbeat)` |

**The first step of that work is a read, not an edit:** whether the `configured` parser tolerates an
unknown field. If it is strict, the Swift field has to land after the TypeScript side accepts it, or
every configuration handshake fails and capture stops - which is the kind of change that looks fine in
a diff and breaks the product.

Also worth deciding then, and not now: whether a 5-second floor is the right number to show a user, or
whether the interface should say "at least a few seconds" rather than a figure that implies precision
the sampling does not have.

### The timeline says how long, and the reinstall trap that hid it for two measurements

```text
时间线 | 2026-10-03 · 4 个片段 | 不到一分钟 · Worked in dsh-computer-history. Observed resources: -
validation-three-platforms.md  Applications: com.microsoft.VSCode | 不到一分钟 · …
```

Evidence: `docs/assets/panel-timeline-duration.png`.

**Two measurements showed the old interface and I nearly recorded the wrong conclusion.** The panel
still said `3 episodes` after the change was committed and built, with the browser cache disabled, so
the interface was not stale - the *installed copy* was. `dsh plugin --profile firstrun add <tarball>`
printed **`added 0`**: pnpm keys an install on the version, the version had not changed
(`0.1.0-dev.0`), so nothing was replaced. Removing the dependency entry and the installed directory
first made it `added 1`, and the new strings appeared.

**The rule: after changing the plugin, check that the profile's installed copy actually changed** -
`grep` for a string you just added in
`~/.dsh/profiles/<profile>/node_modules/<package>/lib/`, not just that the install command succeeded.
A version-stable dev loop has to force the reinstall by hand.

## P2 - the documents a user reads, in Chinese

### The guard first, and its red side is real

`scripts/verify-docs.mjs` holds the rule the plan adopted: anything a user reads has a Chinese
version, anything an engineer reads stays in one language. The user-facing list is **explicit** rather
than discovered - "is this document user-facing" is a judgement, and a rule that guesses would either
miss documents or demand translations of ADRs.

Two checks: every listed document has a `<name>.zh.md`, and the pair was last changed in the same
commit, because a translation that quietly falls behind is worse than none: it is wrong without
looking wrong.

Run against the repository as it stands, it fails on exactly the documents that have no Chinese yet:

```text
SECURITY.md: no Chinese sibling (SECURITY.zh.md)
docs/companion.md: no Chinese sibling (docs/companion.zh.md)
docs/editor-companion.md: no Chinese sibling (docs/editor-companion.zh.md)
docs/adapters.md: no Chinese sibling (docs/adapters.zh.md)
docs/remote-models.md: no Chinese sibling (docs/remote-models.zh.md)
```

That is its red side, taken from the real repository rather than from a synthetic sample.

**It is deliberately not wired into `pnpm verify` yet.** A gate that is red while the work is
unfinished teaches people to ignore it; the guard becomes part of the gate in the same commit that
writes the translations, which is also the commit where it can be seen to pass.

## P3 - the update path, without distribution

### Drift is now a field, and both states were measured live

```text
consistent state (just installed)            version 0.1.0-dev.0, builtAtMs 1791012815224, stale: no
drift state (artifact newer, not installed)  version 0.1.0-dev.0, builtAtMs 1791012815224, stale: YES
                                             command: dsh plugin --profile firstrun add
                                                      /Users/…/dsh-computer-history-0.1.0-dev.0.tgz
```

The plugin works it out by itself: it knows where it was loaded from, finds the profile whose
node_modules resolves to that directory, reads that profile's own dependency spec, and compares the
artifact's timestamp with its own built entry. Evidence for the interface line:
`docs/assets/panel-stale-copy.png`.

**The detector has a self-referential limit, and the first drift run proved it.** With the *old* build
installed, `/state` carried no `release` at all - the detector lives in the new code, which was exactly
what had not been installed. So the first install of a build containing the detector is always silent,
and the feature helps from the second install onwards. The order that demonstrates it is: install the
build that has the detector, then make a newer artifact without installing it.

**The remote half is not started** and is not pretended to be: comparing against a published version
needs a published version, which waits for the owner's decision about distribution. The local half is
what a developer meets every day, and it is what this phase delivers.

## P4 - the collector contract, and the suite that measures it

### The document was wrong about its own boundary, and the suite found it

`docs/collector-protocol.md` claimed that unknown fields are refused. Measured
(`tests/conformance/collector-protocol.spec.ts`):

```text
unknown field        -> ACCEPTED, the key is silently dropped
unknown message type -> REFUSED (unknown collector message type)
not JSON             -> REFUSED (invalid JSON)
```

Nothing leaks either way - a dropped field cannot reach storage - but "silently dropped" means a
collector's mistake is invisible, which is the opposite of a boundary a parser enforces. Making the
collector parser strict is now recorded as an **open contract decision** for the three-platform work,
and the document no longer claims it.

### The cross-platform contract, as data

`tests/conformance/fixtures/adapters.json` states the platform-independent facts every collector must
reproduce: which adapter an application maps to, what surface that adapter has, whether its title is
recorded, and the three refusal reason strings - unchanged, because a platform that invents its own
makes the refusal breakdown incomparable, which is the one thing it exists for. Each adapter carries
per-platform ids (`darwin` filled, `win32` and `linux` as fields P5 and P6 must fill).

The first version of that fixture restated each adapter's **resource kind** and got it wrong (the table
said `none`, the fixture said `file`). The field is gone: the resource kind is the adapter table's own
data, and a copy here would be a second source of truth that can drift.

### Calibration: three deliberate breaks, each red

```text
green (as committed)                  5 passed
claim the terminal records its title  1 failed
invent a refusal reason string        1 failed
point an adapter at an unknown id     1 failed
green again (restored)                5 passed
```

### One more thing the gate tolerated

`pnpm verify` exits zero **with** lint warnings, so a commit landed carrying one (`flatMap` with a
spread). The standing rule is zero warnings, and the exit code alone does not catch it - the warning
count has to be read. Fixed forward in `e30ceee`.

## P5 - the Windows collector, to the line this machine can honestly reach

### Verified here

`native/windows` is a Rust crate whose `platform` module is the only part that touches Windows. The rest
is the message layer from `docs/collector-protocol.md`, and it is tested wherever Rust exists:

```bash
pnpm verify:collector-windows
# windows collector: protocol layer ok (5 tests); UI Automation paths remain unverified without Windows
```

Five tests: the observation carries the documented fields; **there is no field for content** (asserted
against the serialised line, so the boundary is a property of the shape); control characters cannot
synthesise a second message; the other messages match their documented shapes; protected applications are
recognised case-insensitively. Calibrated in both directions - adding a `selection_text` field and patching
the serialiser turns the content assertion red, restoring turns it green.

A missing Rust toolchain prints a **skip that says UNVERIFIED**, never a pass.

### Not verified, and what would verify it

Nothing about UI Automation has been run: there is no Windows machine here. The Windows rows in
`tests/conformance/fixtures/adapters.json` are a mapping the collector is *expected* to produce, and the
fixture now carries that in its own data (`$unverified.win32`), with a test that fails if the note is
removed - so "unverified" has to be deleted deliberately rather than quietly.

The recipe, to be run once on a real machine:

```powershell
cargo build --release --manifest-path native/windows/Cargo.toml
# the host reads the collector from bin/; point the plugin's collector path at the built binary, then:
# 1. work in Notepad, Explorer, Windows Terminal and VS Code for a minute each
# 2. read the rows:   curl -H "$C" "$BASE/recent"
# 3. expect one row per application, each with the application id and, for the editors, a file
# 4. open 1Password and confirm the refusal count moves under 'protected-app', with no row stored
```

Passing means: four rows naming four applications, a `protected-app` refusal that did not store, and the
same three refusal reason strings the macOS collector produces. Until that run exists, every sentence above
about Windows behaviour is a design, not a measurement.

## P6 - the Linux collector, and the rule it exists to honour

### Verified here

`native/linux` shares the message layer with Windows through `native/collector-protocol`, so "the same
fields on every platform" is what the dependency graph says. Three tests, and the one that matters is not
about AT-SPI at all:

> **a collector that cannot observe must say why, because silence is indistinguishable from a machine
> nobody used.**

Until the session-bus check for `org.a11y.Status` is written and run, the crate reports
`permission-required` with a reason rather than `running` with silence.

Sharing the layer produced two findings that separate copies would have hidden:

- `hello` **hardcoded `win32`**, so a Linux binary would have claimed to be Windows. It now takes the
  platform as a parameter, with a test asserting a Linux binary does not claim `win32`.
- the protected-application list moved into the shared crate, so a platform cannot quietly drop one.

### Not verified, and what would verify it

No Linux machine has run this, and the accessibility check itself is not written. The recipe:

```bash
# on a Linux desktop with a session bus
gsettings get org.gnome.desktop.interface toolkit-accessibility      # expect true; if false, enable it
cargo build --release --manifest-path native/linux/Cargo.toml
# point the plugin's collector path at the built binary, then:
#   the first lines on stdout must be hello with platform "linux", then state
#   with accessibility on:    state "running"
#   with accessibility off:   state "permission-required" and a diagnostic naming the reason
# then work in a terminal, the file manager and an editor for a minute each, and read:
curl -H "$C" "$BASE/recent"
```

Passing means: three rows naming three applications with the same three refusal reason strings macOS
produces, and the accessibility-off case reporting a reason rather than silence. Until that run exists,
every sentence above about Linux behaviour is a design, not a measurement.

## P7 - a third editor, and what can be proven without a JVM

### Verified here

A JetBrains plugin is Kotlin, Gradle and the IntelliJ SDK: it cannot be built or run on this machine, and
saying otherwise would be the "it compiles, so it works" failure this plan forbids. But the claim P7
actually rests on is not "I can write Kotlin" - it is **"the endpoint is the same contract for any
editor"**, and that is measured here.

`tests/unit/companion-intake.spec.ts` now has a third-editor block, against the real intake over HTTP:

```text
a JetBrains-shaped report satisfying the shape   -> 201 stored, workspaceRoot delivered
the same report plus a selectionText field       -> 400, nothing delivered
the same report with no token                    -> 401, nothing delivered
```

Two things that matter beyond "it works":

- the refusal of an unknown field is the **companion** behaviour, and it is the opposite of the collector
  parser's, which drops the field - the same asymmetry already recorded as an open contract decision;
- the editor's claim is not trusted: `app.bundleId` is recorded as a claim from a companion, so the audit
  can always tell "an editor said it was PyCharm" from "the operating system saw PyCharm".

### Not verified

No JetBrains plugin exists yet, so nothing has run inside an IDE. The recipe for the first real run is
`docs/editor-companion.md`'s wire format, unchanged: one endpoint, one shape, no token means no request.
The half that remains is packaging and IDE plumbing, not protocol.

### A test I wrote at the wrong layer, and what it taught about the document

`docs/companion.md` says the query string and fragment are removed twice: by the extension before it sends,
and by the host **before it stores**. I wrote an intake-level test asserting the secret was already gone from
the delivered payload. It failed - the payload still carried `token=secret` - and the failure is mine, not the
product's: the intake **delivers**, ingestion **stores**, and the stripping belongs to the second one. The
document's wording is exact; my test read "host" as "intake".

Kept because the distinction is easy to get wrong twice, and because the test would have been a second,
inconsistent statement of a guarantee that `src/host/companion/observation.ts` and the ingestion path already
own. Writing an assertion at the layer where it is convenient rather than where the guarantee lives is the
same mistake as asserting a field name instead of the thing it carries - both produce a green test that proves
nothing about the property anyone cares about.

### P7 second half: the engine-independent contract, pointed at its owners

A second browser engine is a port of an extension, and no second engine can be built or run on this machine.
What is left to do honestly is to say which guarantees belong to the **host** - and therefore hold for any
engine, and are already covered - and which belong to the extension and would have to be re-measured per
engine.

| guarantee the host owns | the test that owns it |
|---|---|
| an unpaired or wrong token delivers nothing | `tests/unit/companion-intake.spec.ts:126` — **refuses an unpaired or wrong token without delivering** |
| an incognito payload is refused host-side | `tests/unit/companion-intake.spec.ts:136` — **refuses an incognito payload host-side** |
| a body the shape has no field for is refused, not ignored | `tests/unit/companion-intake.spec.ts:279` — **refuses a body it has no field for, rather than ignoring it** |
| fields belonging to the other shape are refused | `tests/unit/companion-intake.spec.ts:295` — **refuses fields that belong to the other shape** |
| a file outside the workspace root it claims is refused | `tests/unit/companion-intake.spec.ts:310` — **refuses a file outside the root it claims** |
| a claim that is not an identity is refused | `tests/unit/companion-intake.spec.ts:349` — **refuses a claim that is not an identity** |
| a third editor speaking the same wire format is accepted | `tests/unit/companion-intake.spec.ts:440` — **refuses a field the shape does not have, rather than ignoring it** |

Getting this table right took three attempts, and the failures are the point. The first swept test files for
keywords and produced **44 rows**: "the suite mentions this word" is not "this guarantee has an owner". The
second was written from memory and the check dropped **five of six pointers**, because those titles do not
exist - a table that would have shipped five invented citations. The third reads each title out of the file at
the line it claims, and the script refuses to print a row whose line is not a test.

Everything in that table is a property of the intake or of ingestion: it holds for a Firefox or Safari port
without touching their code. **What is not verified, and cannot be here:** the extension half of those
promises on any engine other than Chrome - `tabs` and `storage` permissions, the incognito exclusion, and the
extension-side stripping all have engine-specific forms, and the privacy matrix in `docs/companion.md` is the
recipe for measuring them (one cell per promise, with a control cell whose failure fails the whole matrix).
Until a port exists and runs that matrix, "works on Firefox" is a design, not a measurement.

## The operations group - degradation, first measurement

### What the interface says when the collector is killed

```text
before              capture: running | accessibilityTrusted: true
immediately after   capture: running | accessibilityTrusted: true
31 seconds after    capture: running | accessibilityTrusted: true
```

The collector was killed with SIGKILL. The state did not change and carried no reason for over half a
minute: **the interface keeps saying it is recording while nothing is recording.** That is the failure mode
the Linux rule is written against - silence is indistinguishable from a machine nobody used - except here it
is worse, because the user believes their history is being kept.

**What this is and is not, so far.** The measurement is exact and repeatable. The cause is not yet
established: `src/host/collector/manager.ts:809` carries a comment about "the degraded state above records
that the exit was unconfirmed", so there is degradation logic in this file, and my first grep for its trigger
(`'exit'`, `child.on`) found nothing - which means one of three things, and the next pass reads the code to
find out which: the listener uses a form I did not search for; the state is degraded only for a confirmed
exit and a SIGKILL never confirms one; or the degraded state is recorded somewhere the API does not report.

Naming those three before reading is the point: the honest next step is a read, not a fix, and definitely not
a fix based on "the state did not change, so nothing handles it".

### The read settles it: the degraded path exists, and an out-of-band death never reaches it

`src/host/collector/manager.ts:212-222` is the second candidate made concrete:

```ts
const exitError = new Error('collector exited before acknowledgement')
this.rejectStateWaiters(exitError)
this.rejectPolicyAck(exitError)
this.markDegraded('collector-exited')
```

So degradation **is** recorded on exit - inside the handshake or stop sequence, where something is waiting for
the child. A collector that dies while running has no waiter, so nothing observes the exit and nothing is
marked. That matches the measurement exactly and makes it a real defect rather than a missing feature: a
crash, an out-of-memory kill or a user killing the process is precisely the case a user meets, and it is the
one case the interface reports as healthy.

The fix is small and belongs at the spawn site: one listener that marks degraded when the child exits without
the host having asked it to. Writing down the shape before writing the code is what the previous paragraph is
for - the first three attempts at this measurement all looked like "the interface is wrong somewhere", and the
line numbers turned it into a five-line change with a test.

### The fix is installed, and the measurement still fails

`manager.ts:166` used to be `void handle.waitForExit().catch(() => {})` - **an exit observer that threw its
result away**, which is the whole defect. It now marks degraded and notifies an unexpected exit when the host
is not the one stopping the child, and the reinstall is verified the way this document prescribes:
`grep -c collector-exited-unexpectedly` returns 1 in the source, in the built `lib/index.js`, and in the
profile's installed copy. Not "the install command succeeded" - the marker itself.

```text
before the kill   capture: running
28 seconds after  capture: running      (no reason field in the state at all)
```

So the fix is present and the interface still reports healthy. That leaves two candidates, and they are
different problems: the listener does not fire (the exit is not reaching it, or a guard swallows it), or it
fires and **the degraded state is recorded somewhere the state API does not report** - the third of the three
candidates this section opened with, which the read had left open and which the measurement now points at.

### The question answered: two states, and the API reports the wrong one

The read answers it without a diagnostic, because the two halves are three lines apart:

```ts
manager.ts:405        this.state = { v: 1, type: 'state', state: 'degraded', reason }   // where the death is recorded
local-backend.ts:233  ...this.capture.getState(),                                        // where the API's capture comes from
```

`markDegraded` does set a real state - it is not an internal flag. But the state the interface reads is the
**CaptureController's**, and the controller has no idea the collector it owns is gone. So the death is recorded
in one object and reported from another, and the second one keeps saying `running`. That is the third of the
three candidates this section opened with, and it is the one that survived contact with the code.

**That conclusion was wrong, and reading the rest of the function is what showed it.** `plugin.ts:124`:

```ts
capture: !this.enabled ? 'stopped' : snapshot?.state?.state ?? 'degraded',
```

The composition **already** reports the collector's state, and it already has a degraded fallback. There are not
two disagreeing sources; there is one source that never learned the collector died. So the cause is back to the
first candidate - **the listener added in the previous pass does not fire** - and the difference between this
pass and the last one is not knowledge, it is method: last pass I read two lines and concluded; the correct
move, which the section said two paragraphs earlier and then ignored, is a diagnostic.

Worth stating plainly, because it is the same mistake this whole phase keeps recording in different clothes:
**part of a function is not the function.** An exit observer that "did not fire" and a report composed from the
wrong object look identical from three lines of code, and only a measurement separates them.

### The measurement, and what it says

A temporary line at the top of the listener, a rebuild, a reinstall verified by grepping the installed copy for
that line, a restart and a `kill -9` on the collector produced **nothing**:

```text
[diag] collector exit observed ...      (never printed)
capture: running | reason: (none)
```

So the listener never ran: **`waitForExit()` does not settle for a child killed out of band.** The observer was
attached to something that never happens, which is why the fix was present, verified present, and silent.

The reliable signal is the pipe closing, which happens when the process is gone however it went, and that stream
is already being listened to two lines further down for protocol data. Attaching the exit observer there is the
next change - and the first attempt to make it was placed before the guard that proves `stdout` exists, which the
type checker refused, and the repair of that attempt did not apply, so the file was reverted rather than left
half-edited. A red tree is not a step forward, and the measurement above is what this pass actually gained.

### There was never a defect: the host restarts a killed collector

The cheapest possible check - the one that would have ended this in the round it started - had not been made:

```text
collector before the kill: 72465
collector after the kill:  73587      -> a new process, a new pid
state: running | reason: (none)
```

The host restarts a collector that dies. `capture: running` was **true**, and it was true in every one of the
five measurements in this section. `tests/unit/collector-hardening.spec.ts` calls it the restart breaker, and
those three tests are what stopped the "fix" written in this pass: it marked degraded on every exit, including
the recoverable ones, and the suite failed with `expect(value.spawns()).toBe(2)`.

So the score for this section is worth stating plainly:

- **every measurement was correct** - `capture` never changed, because it should not have;
- **every explanation for it was wrong** - swallowed exit, wrong object, promise that never settles, observer in a
  dead branch - five readings, each plausible, each falsified in turn;
- **the question that answers all of them took one command**, `pgrep` before and after a kill, and I never asked
  it until the product's own tests pushed back.

The lesson is not "read more carefully". It is that I kept measuring the artifact I was already looking at -
the state the interface reports - and never measured the artifact the question was actually about: **is anything
still observing?** A dead collector and a restarted one report identically from the first, and only the second
question distinguishes them.

## Gate discipline: the record of being stopped

The standing rule is that a commit is read against the gate before it lands, and that a green exit code is not
the standard on its own. Both were earned rather than assumed. The table below is extracted from the commit
messages of this phase - the commits whose own text records the gate refusing the work - and it is generated
from history rather than written from memory, for the reason every other generated table in this file exists.

| commit | subject | what stopped it |
|---|---|---|
| `
5224b73` | docs: P5 to the line this machine can honestly reach | the gate stopped a commit |
| `
194dc6d` | docs: P4 closed - the contract, the suite, and three calibra | the exit code alone was not the standard |
| `
e30ceee` | fix: the lint warning the gate tolerated | the exit code alone was not the standard |
| `
b8b6ee6` | test: the first conformance artifact measures the parser, an | the gate stopped a commit |
| `
496d9f7` | feat: the state reports what the running plugin is | the gate stopped a commit |
| `
1b5f7d7` | feat: three button shapes, so primary and destructive action | the type checker refused the change |
| `
1b77cd6` | feat: separators, theme radii, and buttons that look like bu | the type checker refused the change |
| `
c879ac8` | feat: one spacing scale for the panel, and the five strings  | the type checker refused the change |
| `
bec82d7` | feat: the backend can carry the refusal breakdown (T2.9-1/2/ | the type checker refused the change |

What this record is for: every entry is a change that looked finished and was not. The two that mattered most
were not type errors - a red gate that was read too late, and a commit that carried lint warnings because the
exit code was zero. Neither would have been caught by running the tests again.

## What is measured, what is not, and the command for each

Two gates, read for warnings as well as exit status, at the end of the phase this file covers:

```bash
pnpm verify        # exit 0, 0 warnings, 346 tests, 6 documents guarded, 8 Rust tests
pnpm verify:p1     # exit 0, native privacy and protocol tests passed
```

### Measured on this machine

| what | the command that shows it |
|---|---|
| the preset applied through the interface | `pnpm exec vitest run tests/integration/preset.spec.ts` |
| the first-run screen on a clean store | `docs/assets/panel-firstrun-clean-store.png`, recipe in the P1 section |
| a row after a minute, without a terminal | `docs/assets/panel-firstrow.png`, same section |
| the timeline says how long | `docs/assets/panel-timeline-duration.png` |
| running an older artifact than the one built | `docs/assets/panel-stale-copy.png`, two live runs in the P3 section |
| the collector protocol's enforced behaviour | `pnpm exec vitest run tests/conformance/collector-protocol.spec.ts` |
| the cross-platform adapter contract | `pnpm exec vitest run tests/conformance/adapter-contract.spec.ts` |
| the Windows and Linux message layers | `pnpm verify:collector-windows` (8 tests) |
| a third editor against the real intake | `pnpm exec vitest run tests/unit/companion-intake.spec.ts` |
| six user-facing documents in Chinese | `pnpm verify:docs` |
| the panel's degraded, empty and first-run states | `docs/ui-review.md` and `docs/assets/` |

### Not measured, with what would measure it

| what | why it is not measured | what would measure it |
|---|---|---|
| UI Automation observation on Windows | no Windows machine | the recipe in the P5 section, four rows and a `protected-app` refusal |
| AT-SPI on Linux | no Linux machine, and the `org.a11y.Status` check is not written | the recipe in the P6 section, including the accessibility-off case |
| a second browser engine | no Firefox or Safari port exists | the privacy matrix in `docs/companion.md`, one cell per promise |
| a JetBrains plugin | Kotlin, Gradle and the IntelliJ SDK are not part of this checkout | the wire format in `docs/editor-companion.md`, which the intake already accepts (measured) |
| the remote half of the update path | there is no published version to compare against | the owner's decision about distribution |

The fixture carries the first two in its own data (`$unverified`), with a test that fails if the note is removed,
so "unverified" has to be deleted deliberately rather than quietly.

### The thing this phase was actually about

Seven stages were delivered, and the most expensive work in them was not the code. It was the recurring error
this file records in five different costumes: **measuring the artifact that was already in front of me instead
of the artifact the question was about** - a keyword instead of an owner, a field name instead of the thing it
carries, a convenient layer instead of the layer the guarantee lives in, part of a function instead of the
function, and finally a reported state instead of "is anything still observing". Each one produced something
that looked like evidence and supported nothing, and each was caught by a measurement that took one command.

### CI: what the runners can verify, and what they cannot

<!-- unverified-platforms: win32, linux -->
<!-- Checked against the workflow header and the conformance fixture by scripts/verify-ci-boundaries.mjs. -->

`.github/workflows/collectors.yml` runs the message layer on **macos-latest, windows-latest and
ubuntu-latest** and the whole gate - including `tests/conformance` - on macOS. A Windows or Linux collector
that cannot speak the protocol fails there, which is the half of the objective's CI item that hardware does
not gate.

**What a green run would still not be evidence for:** observation through UI Automation or AT-SPI. Those need
a desktop session with a window to look at, not a runner, so the live rows stay marked unverified in
`tests/conformance/fixtures/adapters.json` and above. The workflow says this in its own header, so that a green
badge cannot be read as a measured platform.

**Not run yet:** the workflow has not executed. Writing it is not running it - the same distinction this file
makes about compiling and running, applied to a file rather than a binary. Its first run needs a push, which
waits for the owner.

## P7.2 - the second browser host (Gecko)

### What was built, and what is proven about it

The companion was a Chromium-only extension: `chrome.*` calls in the worker and in the options page, and a
`service_worker` background. The second engine is added as **one implementation with two manifests**, not a
second copy:

- `extension/engine.js` resolves the namespace once (`browser` when the engine defines it, otherwise `chrome`).
  Gecko defines both names and only `browser.*` returns promises there, so the order is the whole point.
- `extension/background.js` holds every listener and the reporting loop, written against that namespace.
- `extension/service-worker.js` became the entry both engines load; the manifest decides whether the engine
  starts it as a service worker or as an event page.
- `extension/manifest.firefox.json` differs from the Chromium manifest in exactly the three keys where the
  engines disagree (background form, `options_ui` instead of `options_page`, `browser_specific_settings.gecko.id`).
- `pnpm build:extension:firefox` packages the same source with the Gecko manifest written as `manifest.json`,
  and applies the same guard as the Chromium build: MV3, `incognito: "not_allowed"`, no content script,
  permissions within `tabs`/`storage`, loopback hosts only, and **a manifest asking for the other engine's
  background key is refused** rather than packaged.

Measured on this machine: both packages build (`extension packaged for chrome` / `for firefox`), the packaged
manifests differ in the expected keys and agree on every privacy-relevant one, and
`tests/unit/companion-engines.spec.ts` pins those facts plus the "no second copy" invariant (the entry has no
listeners of its own; the shared file names no engine directly).

### The mistakes this entry keeps

1. **The first manifest shape was the Chromium one with keys renamed.** Gecko has no service worker, and a
   `service_worker` key there is not an error the browser reports loudly - the extension loads and never
   reports. The build now refuses the wrong key per target instead of trusting the file.
2. **The type surface caught the missing declaration.** `tsc` refused `extension/engine.js` with
   `TS7016: implicitly has an 'any' type`; `extension/engine.d.ts` was written to mirror `lib.d.ts`, and it
   declares only the members both engines must provide.
3. **`chrome.storage` survived in the options page** after the worker had been converted - three call sites.
   The engine test would not have caught it (it does not load the page); a grep for `chrome.` outside
   `engine.js` did. The options page is the extension's own UI, and it is the surface a person uses to pair, so
   a broken namespace there looks like "pairing is broken", not like "the API is wrong".

### Not verified

**There is no live Gecko row.** No Gecko engine is installed on this machine, so the Firefox package is built
and its manifest is checked, but nothing has loaded it. The row stays marked unverified; the recipe that
produces it is in `docs/companion.md` ("A second engine (Gecko)"), and it is two commands plus one dialog:
`pnpm build:extension:firefox`, then `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* →
`dist/extension-firefox/manifest.json`, then pair the token as on Chromium. Accepting a manifest that parses as
evidence for a browser that never ran it would be the "compiles, therefore works" error this file keeps
returning to.

## The workflow's commands, measured on this machine

`collectors.yml` has still never run on a runner - the repository has no remote - so every command it contains
was run here first, so that the first real run is about the runners and not about the file. Exit codes are the
whole point of the table: a command that "should work" is not a command that worked.

| job | command | exit | what it printed |
|---|---|---|---|
| protocol | `cargo test --manifest-path native/collector-protocol/Cargo.toml` | 0 | `5 passed; 0 failed` |
| protocol | `cargo test --manifest-path native/linux/Cargo.toml` | 0 | `3 passed; 0 failed` |
| protocol | `cargo test --manifest-path native/windows/Cargo.toml` | 0 | `0 passed; 0 failed` |
| suite | `pnpm install --frozen-lockfile` | 0 | lockfile in sync, nothing to change |
| suite | `pnpm verify` | 0 | 61 files / 371 tests, lint 0 warnings |

The Windows row is the one to read twice. `0 passed` is not a failure and not a pass: the Windows crate's
tests are `cfg`-gated to Windows, so on macOS the crate compiles and contributes no cases. On `windows-latest`
the same command runs them. Writing that down matters because "the Windows job is green" and "the Windows
collector was exercised" are different claims, and only the second one is about UI Automation.

## The boundary between "verified by a runner" and "needs a desktop"

Three files state that boundary - the workflow header, the fixture's `$unverified` lists, and this file - and
prose drifts. It is now a declaration in each of the three, checked by a script:

```console
$ pnpm verify:ci-boundaries
ci boundary holds: unverified platforms [linux, win32] agree in the workflow, the conformance fixture and the
validation file; matrix runs on [macos-latest, ubuntu-latest, windows-latest]
```

Red/green, because a check that has never failed is not a check: editing the marker in this file to claim
`darwin` as unverified produces
`docs/validation-three-platforms.md says [darwin,linux,win32] but the fixture's $unverified lists say [linux,win32]`
and exit 1; reverting it returns the green line above. The script also asserts the matrix still names all three
runners, so a platform cannot quietly leave the workflow while the prose still promises it.

## Ingestion baseline

The benchmark gate asserted one thing - 10k observations ingested in under 30s - which hides both the
throughput a regression would move and the store growth it would not. It now prints three numbers and the
baseline is recorded from them. Two runs, same machine, content identical (the store size is byte-for-byte the
same because the input is deterministic):

| run | ingest 10k | throughput | store after 10k |
|---|---|---|---|
| 1 | 11 025 ms | 907 obs/s | 6 295 552 B |
| 2 | 10 864 ms | 920 obs/s | 6 295 552 B |

Environment: macOS 27.0, node v24.5.0, commit `a623507`.

Reproduce with one command, which prints the same three lines:

```console
$ pnpm benchmark:ingestion
INGEST_10000_MS 11025
INGEST_10000_PER_SEC 907
INGEST_10000_DB_BYTES 6295552
```

Reading it: the spread between runs is under 2%, so a future run more than a few percent off is worth looking
at, and a store that grows per observation faster than ~630 B is a storage-shape change rather than noise. This
is one machine and one shape of input - it is a baseline, not a bound, and the file says so rather than
implying a guarantee the measurement cannot make.

## Rendered-state verification, as a command instead of a habit

`scripts/verify-panel-render.mjs` drives a headless Chromium over the DevTools protocol against a running Host,
forces the states that are awkward to produce by hand (blocking requests so a read fails, and blocking one read
so the others still succeed), asserts what must and must not appear in the rendered text, and writes a
screenshot plus the rendered text per state.

```console
$ PANEL_URL='http://127.0.0.1:19430/?token=…' node scripts/verify-panel-render.mjs
  loading                      captured before the reads settle
  ready-light                  panel with data
  partial-failure              timeline blocked; other sections must still render
  all-reads-failed             every history read blocked
  settings-read-failed         controls: enabled,enabled,disabled
  focus-by-keyboard            never reached our controls; focus ended on BUTTON:电脑使用记录
  ready-dark                   same panel in dark

rendered-state checks: 45/46 passed; screenshots in .debug/panel-render
```

The forbidden strings it checks are the regressions this phase actually shipped: a browser error printed as
copy, a raw Host reason code, and the Host's English sentences reaching a Chinese interface.

### What it found

1. **Fixed in this pass:** `Failed to fetch` was still reaching the reader on two paths the earlier fix had not
   covered. `store.ts` keeps the raw cause (correct - it is diagnostic state), but `settings-view.ts` and the
   panel's alert rendered `snapshot.error` / `controls.error` directly. Both now go through `failureText`, which
   is where a cause becomes copy.
2. **Open:** the settings dialog's rows are not reached by 26 tab presses; focus ends on the sidebar entry
   (`BUTTON:电脑使用记录`). Whether that is the shell keeping focus in its own scope or our rows not being in
   the tab order is not yet decided by evidence, and the check now records where focus landed instead of only
   reporting that it did not arrive.

### Mistakes this script's own first versions made, kept because they are the phase's recurring error

- It reported two product failures while the panel had never opened: it clicked `Computer History` in a Chinese
  interface. Matching by an English label in a localized shell is the same mistake as measuring a keyword
  instead of an owner.
- It detected the blocking dialog by matching a phrase from the shell's preview notice; the dialog actually in
  the way belonged to a different plugin and said something else, so the dismissal never ran and every later
  click landed on the overlay. Detection is by DOM presence now.
- It clicked the outermost element whose text contained the label, and the first version used exact text, which
  never matched the sidebar's `◷ 电脑使用记录`. It now prefers the shortest clickable ancestor.
- The Gate itself caught the author: a ternary used as a statement is a lint error, and a missing `failureText`
  import was a type error; the build was run before both were fixed, which is how a green screenshot can sit on
  top of a red tree.

## T7.1 JetBrains client: what the live runs taught, and one correction

The client is built and loads in a real IDE (`Loaded custom plugins: Computer History Companion (0.1.0)`), and
the intake answers its payloads. Getting from "it posts" to "it is stored" turned out to be four gates, each of
which the first attempts failed at, each verified rather than assumed:

1. **The intake is only for a Host that owns capture.** `deliver` returns false unless
   `enabled && ownsCapture && state === 'running'`; a second Host on the same machine gets `202 {"stored":false}`.
2. **`ownsCapture` is a lock in the plugin's *data directory*, not in `DSH_HOME`.** A separate `DSH_HOME`
   therefore does not isolate it: both Hosts take the lock in `~/.dsh/computer-history` and only one wins.
   Giving the test Host `dataDirectory` of its own is what moved the state to `capture: running`.
3. **A profile patch entry replaces the whole config; it does not merge.** Writing only `companionPort` in the
   patch dropped `enabled`, and the Host answered `409 computer history capture is disabled` until the entry
   carried `enabled: true` as well.
4. **Policy is the last gate, and it behaves exactly as designed.** A fresh store starts with the built-in
   protections and *no* allow rules, so an unlisted application is accepted (202, well-formed) and dropped
   (`stored: false`). The declared app `com.jetbrains.intellij` is in the shipped preset - the shared store
   allows it - so on a real installation this gate is already open; the isolated store needed the rule, which
   the product's own policy API took once the payload shape was right (`builtIn` is a boolean over HTTP and a
   0/1 in SQLite - the first two attempts were refused with exactly those messages).

**Correction to an earlier claim in this file.** I recorded that LightEdit - opening a single file - puts the
file in the default project, where project-scoped listeners are not registered, and rewrote the client to
report from an application-scoped `EditorFactoryListener` instead. The evidence contradicts half of that: runs
*before* the rewrite did report from the project-scoped hooks, with `workspaceRoot` `/tmp/jb-live/src`, so the
file listener does fire in LightEdit. After the rewrite the same run produced **no report at all**, which is
worse than what it replaced. The next measurement is therefore not another theory but a diagnostic: log whether
the application listener is registered at all in this build (the `applicationListeners` declaration is
deprecated upstream and this distribution ships no application-initialized hook), and whether an editor is
created at all in that run. Until a run produces the row, the JetBrains live row stays **unverified**.

**Not verified:** no live JetBrains row exists yet. The client, the four gates and the intake's answers are
measured; the row is not.

### The trigger, measured: LightEdit runs neither hook

The last live run settles the question the previous round left open, and the answer is not the one the theory
predicted. The IDE log shows the plugin loaded and the file opened - and nothing at all from the plugin:

```
PluginManager - Loaded custom plugins: Computer History Companion (0.1.0)
LightEditProjectManager - LightEditProjectImpl loaded in 367 ms
LightEditServiceImpl - Opened new tab for /tmp/jb-live/src/Main.kt
```

No `postStartupActivity` line, no project listener line. So in LightEdit - which is what opening a single file
produces, and the `LightEditProject` is a special lightweight project - **neither registered hook runs**. The
earlier reports in this file came from runs where the project activity did fire, which means the trigger is not
reliable across LightEdit runs rather than merely mis-wired; a client that reports only when an event happens to
be delivered is not a client anyone can rely on.

Two candidate routes were checked against the distribution rather than assumed, and both are absent from this
build: `com.intellij.openapi.startup` ships only project-scoped activities, and `EditorFactoryListener` has no
`init` to attach from. What is left is the design that does not depend on those hooks at all: report the
editor the IDE is currently showing on a timer, with the event hooks kept as a latency optimisation rather than
as the trigger. That is the next change, and the row stays unverified until a run produces it.

### The JetBrains live row

Produced, with the client's own log and the row it wrote:

```
computer-history: intake answered 201 for /tmp/jb-live/src{"stored":true}
```

```console
$ sqlite3 -header "file:/tmp/jb-verify-home/data/history.sqlite?mode=ro" \
    "select source_provider, source_adapter, bundle_id, surface_kind, workspace_root
     from observations where source_provider='companion' order by observed_at_ms desc limit 1;"
source_provider|source_adapter|bundle_id|surface_kind|workspace_root
companion|jetbrains|com.jetbrains.intellij|editor|/tmp/jb-live/src
```

The identity is the client's own declaration: `bundle_id` is what the plugin says it is, validated by shape and
judged by the Host's policy like any other observation, and the row is stored because the declared application
is allowed. The store is an isolated one (`dataDirectory` of its own, so the capture lock is this Host's), which
is why the row is not in the shared store the owner's application uses - the same run against that store would
be refused by the lock, not by the client.

### Two conclusions drawn from silences, and what logging settled

Both wrong turns in this section had the same shape: a run produced nothing, and the nothing was read as
evidence before it was made unambiguous. Logging every hook unconditionally is what settled it.

1. *"Project-scoped listeners are not registered for the default project."* **Wrong.** The project-scoped
   `FileEditorManagerListener` is exactly the hook that fires here: `computer-history: fileOpened for
   /tmp/jb-live/src/Main.kt`, followed by the report that stored the row.
2. *"The deprecated application-level `applicationListeners` registration is honoured by this build."* **Also
   wrong.** With the same unconditional logging in place, the application-scoped `editorCreated` never appears,
   so that registration does not attach here. It has been removed rather than left in as decoration.

What is actually measured: the project-scoped file listener fires in LightEdit and stores the row; the
project activity does not reliably run there (so it is a latency optimisation, not the trigger); and the
application-scoped route does not exist in this distribution.

**Measured, with the recipe:** opening a single file puts the IDE in `LightEditProject`, where the project
activity does not reliably run, so an application-scoped listener is what makes the client dependable; the
intake only stores for a Host that owns capture (its own `dataDirectory`); and the declared application must be
allowed, which the shipped preset already does.

## The keyboard-focus check, and three variants of one mistake

This one step of `scripts/verify-panel-render.mjs` has now measured the wrong surface three times, each variant
passing or failing for a reason that had nothing to do with the question:

1. It clicked a sidebar entry and then tabbed, so all 26 presses went round the shell's own focus ring and the
   check blamed the plugin for where the shell had put focus.
2. It detected "the dialog holds focus" with a fallback to `document` when no dialog was open, which made the
   assertion vacuously true, and it then read `.ch-main` - the *panel* - as evidence that the settings surface
   was showing.
3. With the surface assertion narrowed to `.ch-settings-list` it must actually be open, and the run that would
   have shown that crashed in the DevTools connection before reaching the step.

What is established: the settings rows render (they were visible in the screenshot states), the plugin's own
controls are focusable, and every earlier claim about tab order in this file was about a surface the check had
not confirmed. What is not established: anything about the keyboard path through those rows. The step is
therefore reported as **unverified**, the same standing as any other row without a live record, rather than
being counted as a pass or a product defect.

Next action, one clean run with the narrowed assertion, plus making the CDP connection failure a labelled
error rather than a stack trace: a check that dies mid-run cannot be distinguished from a check that found
nothing, which is the same lesson this file keeps re-learning in a new costume.

### The focus step, resolved: it never had the surface

The step now refuses to measure a surface it has not confirmed, and the first run with that rule gives the
answer: `the settings surface is showing our rows` fails. `.ch-settings-list` is not in the DOM at that point,
so all four earlier variants - tabbing from the shell, treating `document` as the dialog, accepting `.ch-main`
as the settings surface, and finally this one - failed at the same place: the harness never opened the plugin's
settings section at all.

That is worth stating precisely, because the difference matters:

- **Not a product defect.** Nothing was measured about the keyboard path through the settings rows, so nothing
  can be concluded about them either way.
- **Not a pass either.** The step remains unverified. What changed is that it now fails loudly and names the
  missing surface instead of measuring whatever happened to be on screen and attributing the result to the
  plugin.

The immediate next step is making the section selection reliable - clicking a nav item by text is what has been
failing - and the step is written so that this failure and a real "the rows are not in the tab order" failure
cannot be confused.

Also fixed in passing: the step's own expressions are now plain concatenated strings. The previous version built
them with nested template literals, produced an invalid one, and the browser's refusal
(`Failed to deserialize params.expression`) surfaced as a stack trace rather than as a labelled failure - the
same "cannot tell a dead check from a negative result" problem the file already records twice.

### Focus step, next narrowing: the navigation, not the assertion

Two corrections in this step, both narrowings rather than fixes:

- The assertion now names `.ch-settings-item`, the class `settings-rows.ts` renders in every settings state.
  `.ch-settings-list` is rendered by one section's list wrapper, so asserting on it reported a missing surface
  while the rows were on screen in another state of the same run (`controls: enabled,enabled,disabled`).
- Section selection tries every candidate label and verifies the result, because the previous version clicked
  `panelLabels.at(-1)` - the English name - in a Chinese interface and selected nothing.

With both in place the step still reports zero rows: after a fresh load, opening the settings dialog and
clicking the entry does not render the section. This is now clearly the navigation step, not the assertion,
and not anything about the plugin's markup. The keyboard question therefore stays **unverified**, with the
remaining work named: reach the section in the fresh-page flow (the state dump for that step is
`.debug/panel-render/focus-by-keyboard.txt`, which shows what was on screen instead).

### The focus step: what the state dumps finally showed

Every attempt to reach the settings section in the *focus* step failed, and the dumps the check writes beside
each screenshot say why in one line. Compare the two:

```
# settings-read-failed (the step that works): the settings dialog is open
… 设置 | 通用设置 | 模型 | 内置插件 | Agent 预设 | 电脑使用记录 | Vision Router | 打开配置文件 | 关闭 |
  权限 | 语言 | 外观 | 字号大小 | 工作步骤展示 | 快捷键 …

# focus-by-keyboard (the step that fails): no settings dialog at all
… 设置 | 电脑使用记录 | 这台电脑被用来做了什么，只保存在本机。 | 采集：已停止 …
```

The section is reachable; the failing step simply never had the dialog open. Two fixes were tried and neither
was the cause: exact-match nav-item clicking, and trying every candidate element until the dialog appears. The
difference that does track the two states is that the working step opens settings **without reloading the page**
first, while the focus step inserts a `Page.reload` before the keyboard walk. So the next attempt reuses the
working flow and walks the keyboard from there, instead of re-deriving the navigation a fifth time.

Kept because it is the phase's recurring error in its purest form: four rounds of guessing at selectors, when
the check had been writing the answer next to every screenshot the whole time. The dumps exist for exactly this
and were read last.

### The settings section was never selected - in any step

The last dump reading settles it: the dialog that step 5 opens is real, and it is showing the **native** 通用设置
section - 权限 / 语言 / 外观 / 字号大小 / 工作步骤展示 / 快捷键 - not the plugin's. `.ch-settings-item` is
therefore absent, correctly. No attempt in this check has ever selected the plugin's own settings section, which
is why the keyboard question has stayed unmeasured through four rounds of selector guessing: the surface was
open, one nav click away, and showing something else.

The check now fails loudly at that point instead of measuring the native rows, which is the whole reason this
took until now to see. The remaining work is one click on the `电脑使用记录` nav item inside the settings dialog,
verified by `.ch-settings-item` appearing, and only then does the keyboard walk mean anything.
