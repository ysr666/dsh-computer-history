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
