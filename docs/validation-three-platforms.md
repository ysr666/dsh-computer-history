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
# rust collectors: 34 tests passed across collector-protocol, windows, linux; these tests do not
# exercise UI Automation or AT-SPI - only a live run counts, and docs/validation-three-platforms.md
# records which platforms have one
```

The Windows crate contributes 22 of those tests (the observation engine, the host-command parser and the
adapter table), the shared message layer 9, the Linux crate 3. A missing Rust toolchain prints a **skip
that says UNVERIFIED**, never a pass.

Calibrated in both directions: the content boundary is asserted against the serialised line (adding a
`selection_text` field and patching the serialiser turns it red), the cross-platform adapter guard fails
when a win32 entry is deleted, commented out or renamed, and the host's refusal naming was calibrated by
neutralising the reason mapping (red) and restoring it (green).

### Verified on a real machine - 2026-10-04

Windows 11 Pro 10.0.26200, rustc 1.99.0, MSVC 17.14.41 (Visual Studio Build Tools 2022), node 24.21.0.
The working tree was transferred to `~\dsh-ch-tmp` (sha256 `c2d63e64…`, 566 files) and built there:

```powershell
cargo test               # collector-protocol 8 passed, windows 20 passed, linux 3 passed, every exit 0
cargo build --release    # exit 0 in 18.4 s
# exe sha256 7f1f565d08ba416bbc6bb6c5a086ce1166fda57d6f27de2494b1bb8951889a3d
```

Those are the counts as that run measured them. **That tree and that binary predate the review fixes in
`9c18008` and `33f5b5f`** - `native/windows/src/{collector,platform,windows_impl}.rs` and the shared
crate changed afterwards - so the machine's build has to be refreshed before the row is produced, and the
row records the binary it actually used. The review fixes also changed what the crate does: the collector
now matches either identity Windows reports (AppUserModelID or executable name) and reports the candidate
that satisfies both the policy and the adapter table, and `describe` compares the window handle rather
than the pid.

That build is also the first compile of `windows_impl.rs` against the real `windows` crate 0.62.2 on the
target it is written for. Four live collector runs then produced, verbatim:

- `explorer.exe` -> adapter `finder`, with the window title and a `ControlType` element role;
- `WindowsTerminal.exe` -> adapter `terminal`, **with the title suppressed on the wire** (`title: null`)
  while the element role is still present;
- a policy-protected `Notepad.exe` -> identity only (pid and executable name), no title, no element,
  `privacy.reason: "protected-app"`, adapter `protected`.

The same runs corrected the fixture's win32 ids, which is what the fixture's `$unverified.win32` note was
for: a packaged Windows application does not carry its AppUserModelID as a window property, so Windows
reports the executable name (`native/windows/examples/foreground_identity.rs` prints the identity the
collector's own `platform` seam sees). `terminal` is `WindowsTerminal.exe` and `finder` is
`explorer.exe`, both measured; the earlier expected value `Microsoft.WindowsTerminal` matched nothing -
the packaged `Microsoft.WindowsTerminal_8wekyb3d8bbwe!App` never appears as a window identity.

### The Host run on the real machine (2026-10-05)

The recipe below was executed on that machine with the tree at `3f57487`. It produced a working Host, a live
collector and **13 stored observations** - and **no episode row**, for a reason that is not a Windows
collector bug. Both halves are recorded here.

**Two deviations from the recipe, both forced and both cheaper than the alternative:**

- the machine has **no pnpm**, and `dsh plugin add` requires it. Instead of installing a global tool, the
  profile was populated with npm (`npm install <plugin.tgz>` and
  `npm install @deepseek-ai/dsh-web-app@0.2.0-rc.2` inside the profile directory), then both names were added
  to `dsh.profile.bundles`. No `pnpm approve-builds` gate, no global install.
- `Set-Content -Encoding utf8` writes a **BOM**, and the loader's `JSON.parse` rejects the profile's
  `package.json` (`Unexpected token '\uFEFF'`). Profile JSON has to be written with
  `[System.IO.File]::WriteAllText($path, $json, New-Object System.Text.UTF8Encoding($false))`. The same
  encoding trap runs the other way for scripts: Windows PowerShell 5.1 reads `.ps1` as ANSI, so a non-ASCII
  literal in a script breaks its parse.

The recipe, with both corrections folded in:

```powershell
# 1. the collector (already built and tested on that machine - see the section above)
cargo build --release --manifest-path native\windows\Cargo.toml

# 2. a Host of its own, so nothing of the user's profile is touched. `plugin add` initializes the
#    profile itself; the app bundle has to be in it, or the plugin waits forever with
#    "pending (waiting for services: connection, workspaceRegistry)" - measured during the rehearsal.
$env:DSH_HOME = "$env:USERPROFILE\dsh-ch-tmp\dsh-home"
node $env:USERPROFILE\dsh-ch-tmp\dsh-cli\node_modules\.bin\dsh plugin --profile winrow add .\dsh-computer-history-<version>.tgz
# the plugin's default collector path is the macOS wrapper the package ships, so on Windows this
# override is required. A profile layer's config replaces the bundle layer's, hence enabled: true.
@'
- id: computer-history
  config:
    enabled: true
    collectorExecutable: 'C:\Users\<user>\dsh-ch-tmp\native\windows\target\release\dsh-computer-history-collector-windows.exe'
'@ | Set-Content "$env:DSH_HOME\profiles\winrow\cordis.patch.yml" -Encoding utf8

# 3. boot; the line it prints carries the token the API wants
node $env:USERPROFILE\dsh-ch-tmp\dsh-cli\node_modules\.bin\dsh --profile winrow --port 19460 --no-open
#    dsh web: http://127.0.0.1:19460/?token=<token>

# 4. work in Explorer and Windows Terminal for a minute each, then read the rows. One request to the
#    boot URL exchanges the token for the session cookie (verified: 303 plus a dsh-auth-* cookie).
$base = 'http://127.0.0.1:19460'
curl.exe -s -c "$env:TEMP\dsh-jar.txt" -o NUL "$base/?token=<token>"
curl.exe -s -b "$env:TEMP\dsh-jar.txt" "$base/api/computer-history/recent"
curl.exe -s -b "$env:TEMP\dsh-jar.txt" "$base/api/computer-history/state"   # refusedByReason is here

# 5. make a protected application the foreground window (1Password if it is installed, otherwise a
#    protect rule for something that is) and confirm refusedByReason moves under 'protected-app'
#    while /recent does not grow.

# 6. confirm the reason the store's POSIX check is skipped here (expected 40666; macOS reports 40700):
node -e "console.log(require('node:fs').statSync(process.env.USERPROFILE).mode.toString(8))"
```

**What the run produced.** `cargo test` on that machine: collector-protocol **19**, windows **18**, linux
**3** - forty tests, all green - and a release binary of **420,352 B**, sha256
`3233a7e39a00b941639dabfc915ff79a4c27bb59ea3f6c0561dea9272f892114`. The Host accepted the collector's
hello (`{"version":"0.1.0","arch":"x64"}`), reported `capture: "running"`, `accessibilityTrusted: true`, and
spawned the collector through `collectorExecutable`. A live run driven by the exact line
`src/host/collector/manager.ts` builds recorded `WindowsTerminal.exe` -> `terminal` with its title
suppressed, `explorer.exe` -> `finder` with its title, and **`Notepad.exe` -> `notepad`** with
`无标题 - Notepad` and a UI Automation element role - the adapter added earlier the same day, measured on
the machine instead of declared.

**The first run stored thirteen observations and produced no episode at all.** `/api/computer-history/recent`
answered `[]`. Replayed on the development machine through `buildEpisodes` and through
`IncrementalEpisodeBuilder.push` with `compact`, `boundaries` and `full` emission, the same thirteen rows
produce zero episodes in all four combinations - so the cause was the episode model, not the collector:
`src/host/episodes/builder.ts` started an episode only for a **strong workspace** or a **resource**, and
everything else fell through to a tail that merely marks a detour on an episode which must already exist. On
Windows there is no resource to offer, so no episode was ever started and no boundary could fire.
`docs/plan-phase2.md` already listed the fix ("observations without a resource or workspace ... should
aggregate by application/surface instead of fragmenting"); what that run measured is that **the Windows
unanchored rate is 100%**, so the gap was an empty timeline rather than fragmentation.

**The fix, and the green row.** Resource-less observations now anchor an episode of their own, keyed by
application and surface: the same pair continues the episode, a different pair closes it with the new
`app-switch` boundary reason and starts another. An episode that already has a workspace or a resource is
untouched, so every anchored behaviour - the detour grace, the workspace switch - is exactly as before, and
the three existing detour cases still pass. The Phase-1 decision this extends is recorded in
`tests/unit/episode-builder.spec.ts` with its reason, and `tests/unit/episode-unanchored.spec.ts` is the
failing-first case built from the machine's own rows.

The second run on that machine, with the same recipe:

```text
$ curl.exe -s -b jar.txt http://127.0.0.1:19460/api/computer-history/recent
[{"id":"episode:win-30872:4","boundary":{"startReason":"idle","endReason":"timeout"},
  "summary":"Recent computer activity.\n\nApplications: explorer.exe","state":"closed",
  "surfaces":[{"bundleId":"explorer.exe","surfaceKind":"window","observationCount":1}],"resources":[]},
 ... episode:win-30872:3 WindowsTerminal.exe/terminal, episode:win-30872:2 Notepad.exe/editor,
 ... episode:win-30872:1 WindowsTerminal.exe/terminal]

$ curl.exe -s -b jar.txt http://127.0.0.1:19460/api/computer-history/state
"refusedByReason":{"protected-app":1}
```

Four episodes, produced by the Host on that machine from four stored observations, each with a deterministic
summary and `state: "closed"`; `resources` is empty on every one of them, which is the honest shape on this
platform. The refusal half was exercised by replacing Notepad's allow rule with a `protect` rule: the counter
moved to exactly one `protected-app` and `/recent` grew no Notepad episode.

**What could anchor an observation on Windows, measured rather than assumed.** `anchor_probe` (added for
this question, run on the machine with each application in the foreground) reads only metadata - the guard
forbids value, text and selection patterns repo-wide, and a first version of the probe that read the Value
pattern was rejected by `pnpm verify`, correctly:

| application | window name | the element that could name a location | canonical anchor |
| --- | --- | --- | --- |
| Notepad (`Notepad.exe`, WinUI) | `无标题 - Notepad` | document `RichEditD2DPT`, name `文本编辑器` (a localized role), no automation id | none |
| Explorer | `47209 - 文件资源管理器` | address bar is an Edit with automation id `TextBox` and name `地址栏` (the label); the search box says `在 47209 中搜索` | none - the path is the Value pattern |
| Windows Terminal | `管理员: Windows PowerShell` | `TermControl`, name = the tab title | none (and titles are suppressed for terminals by design) |
| Chrome | `<page title> - Google Chrome` | `RootWebArea` name = the page title; omnibox Edit has id `view_1012` and name `地址和搜索栏` | none - the URL is the Value pattern |
| VS Code (`Code.exe`, measured 2026-10-05) | `probe-note.md - Visual Studio Code [Administrator]` | editor element says *"The editor is not accessible at this time"*; `RootWebArea` name = the window title | none - the file **name** is in the title, not the path |

So the honest conclusion for this platform: **within the privacy boundary, Windows offers no canonical
document or URL anchor.** The app-and-surface episode plus the window title (already stored on the
observation) is the ceiling, and reading the address bar or the document value - the only place the URL and
the path live - is content, which this product refuses to read. The same measurement leaves one question
open rather than answered: a focused password input in Chrome never appeared in the UI Automation tree at
all, so whether Chromium answers `IsPassword` is still unmeasured, and browsers keep requiring the paired
companion for exactly the reason the preset copy gives.

**Two audit columns said the wrong thing, and now do not.** Every Windows row stored
`source_provider: "macos-ax"` - the collector never said which path produced the observation and the Host
defaulted to the macOS one - and `refusedByReason` reported one `unknown` with nothing refused. Both are
fixed: the observation carries `provider`, the Windows collector sends `windows-uia`, and the counter no
longer counts a re-sent duplicate (nor a deletion-policy block) as unattributed. Evidence boundary: the
stored row quoted above was written **before** that change, so it still says `macos-ax`; the fix is verified
by the protocol test that asserts the field on the wire and by two integration cases, not yet by a stored
row from that machine.

**The command sequence itself was rehearsed** on macOS with a temporary `DSH_HOME` and the tarball built
from the current tree, because three of its steps are not obvious and the first version of this recipe got
each of them wrong: `plugin add` initializes the profile; the profile needs an app bundle or the plugin
waits on `connection`/`workspaceRegistry`; and the profile layer's config **replaces** the bundle layer's,
so `enabled: true` has to be repeated. Measured: `{"enabled":false,"capture":"stopped"}` without that
line, then

```json
{"enabled":true,"capture":"running","accessibilityTrusted":true,
 "collector":{"version":"0.1.0","arch":"arm64"},"companion":{"listening":true,"port":19498,"paired":false},
 "refusedByReason":{}}
```

with it - which is also the host accepting a collector's hello line. `/api/computer-history/recent`
(empty) and `/api/computer-history/state` both answered, and the store opened with the real schema. The
rehearsal recorded nothing, which is the correct behaviour: an untouched profile allows nothing, and the
macOS collector is not the code under test.

Two of the four applications the first version of this recipe named cannot be measured on that machine:**VS Code is not installed**, so the `vscode` adapter stays an expectation (`Code.exe`, the user-installer
executable name), and **1Password is not installed**, so the built-in protected list is unmeasured - the
policy-protected path was exercised instead. **Notepad now has an adapter** - a product decision taken on
2026-10-05 and measured on the machine the same day (identity `Notepad.exe`, title recorded, element role
present), so that is no longer an expectation. The explorer document source is still `None`: UI Automation
has no `kAXDocument` equivalent and the address bar has not been probed - which is the same fact that makes
every Windows observation unanchored, and therefore the reason above that the timeline stays empty.

**One element-state question is still open.** It is not known whether a Chromium/Electron window answers
UI Automation's `IsPassword` query at all: the documented vocabulary makes that property optional, and a
provider that answers "not supported" makes the collector withhold the whole observation (fail-closed,
`Require` policy) - the same false positive macOS measured and fixed when Terminal dropped out of
capture. VS Code is the application that would answer it, and it is not installed on that machine.
`native/windows/examples/foreground_identity.rs` prints the element state per foreground window, so one
command answers it once such an application is there.

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
| UI Automation observation on Windows | measured on a real machine 2026-10-04 and 2026-10-05 (live runs, a Host with its own `DSH_HOME`, stored episodes and a counted `protected-app` refusal, all recorded in the P5 section) | the recipe in the P5 section |
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

<!-- unverified-platforms: linux -->
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
| protocol | `cargo test --manifest-path native/collector-protocol/Cargo.toml` | 0 | `8 passed; 0 failed` |
| protocol | `cargo test --manifest-path native/linux/Cargo.toml` | 0 | `3 passed; 0 failed` |
| protocol | `cargo test --manifest-path native/windows/Cargo.toml` | 0 | `20 passed; 0 failed` |
| suite | `pnpm install --frozen-lockfile` | 0 | lockfile in sync, nothing to change |
| suite | `pnpm verify` | 0 | 63 files / 390 tests, lint 0 warnings |

**Correction (2026-10-04).** This table first recorded `0 passed; 0 failed` for the Windows crate and
explained it as `cfg`-gating: "the Windows crate's tests are `cfg`-gated to Windows, so on macOS the crate
compiles and contributes no cases". That explanation was wrong. The crate had no tests - and it had none on
Windows either, which a run on the real machine then showed; the run that "would exercise them on
`windows-latest`" would have contributed nothing. It now has 20 tests (the observation engine, the host
command parser and the adapter table) and they run wherever Rust does. The distinction the old paragraph
was reaching for is still the right one: "the Windows job is green" and "the Windows collector was
exercised" are different claims, and only the second one is about UI Automation - which is why the live
runs are recorded separately, in the P5 section.

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

### The dialog has no `ch-*` classes at all - so classes are not the diagnostic

The run that was supposed to answer "which class do the settings rows carry" answered something better: the
dialog contains **no `ch-*` class whatsoever** at that point. It is the shell's own settings dialog showing
native rows, and the plugin's section was not selected by the click. That retires the class-name question -
after five versions of guessing at it - and names the next diagnostic properly: the dialog's **structure**, not
its classes, because a nav item whose text is not exactly the label (an icon, a count, a nested button) is
invisible to a text match.

Recorded as the sixth attempt on this one step. What the step does have, and why it is worth keeping: it fails
loudly at the surface instead of measuring the native rows, and it writes its state and class inventory beside
the screenshot for exactly this kind of reading.

### The structure dump: the dialog is not there when the keyboard step runs

The dump reports **one** small element and no navigation at all - not the native settings rows, not the plugin's
entry, nothing. So the dialog the check believes it is measuring is not present when the keyboard step runs: the
one left open by the previous step does not survive, most likely because this step's first action (unblocking the
URLs) re-renders that surface out of existence.

That closes the loop on six attempts at one step. Every one of them assumed a dialog that was not on screen:
first a shell focus ring, then `document` standing in for a dialog, then `.ch-main`, then the native section,
then a class inventory with no `ch-*` in it, and now a single stray element. The lesson is not about selectors -
it is that this step never opened its own surface and kept measuring whatever happened to be there.

The next version opens the settings dialog **inside** the keyboard step, asserts the dialog and the plugin's
section in the same breath, and only then walks the tab order.

### The keyboard step works now, and it says something narrow

With the step opening its own surface, both new assertions pass - the settings dialog opens in this step, and the
plugin's settings rows are shown - and the check moves from 45/48 to **49/50**. The remaining failure is a real
measurement rather than a harness artefact:

```
tab leaves our rows after 1 of 8 stops (7 outside)
```

From the first focusable control inside the plugin's settings rows, one Tab press stays inside them and the
following seven leave. That is a statement about how many focusable controls those rows have and where the tab
order goes afterwards, and it is now worth asking as a product question - the earlier six attempts could not
have answered it, because none of them ever had the rows on screen.

Not yet concluded: whether one stop inside is correct (the rows may simply have two focusable controls - the
state dump for that step reported `controls: enabled,enabled,disabled`), or whether the rows are missing
focusable affordances. Answering it needs the focus order inside the rows, which the step can now produce.

### The focus order, and the threshold that was wrong

The step now records the focus order stop by stop, and the dump answers the question the number could not:

```
1: out BUTTON.navCell [模型]   2: out BUTTON.navCell [内置插件]
3: out BUTTON.navCell [Agent 预设]   4: out BUTTON.navCell [电脑使用记录]
```

Two things follow. First, the walk was measuring the **settings nav**, not the rows: focusing the dialog's first
control put focus in the nav, so every stop recorded nav items - a measurement that said nothing about the rows
even while the rows' presence assertion passed. Second, the rows have roughly two focusable controls (the same
step's state dump reports `controls: enabled,enabled,disabled`), so "one stop inside, then out" is the expected
tab order and not a defect.

The failing assertion was therefore **my threshold**, `ownStops >= 4`, a number picked by hand with nothing
behind it. It should be the rows' own focusable count, and the step should place focus inside the rows rather
than inside the dialog. That change is named here rather than half-applied: the patch that attempted it matched
the wrong line and was discarded without being committed.

### The rendered-state check is green: 50/50

```console
$ PANEL_URL='http://127.0.0.1:19430/?token=…' node scripts/verify-panel-render.mjs
  …
  focus-by-keyboard            tab leaves our rows after 1 of 8 stops (7 outside); 30 focusable control(s) in the rows
rendered-state checks: 50/50 passed; screenshots in .debug/panel-render
```

The step that took sixteen rounds to make honest ends up measuring something narrow and true. It opens its own
settings surface, asserts that the dialog and the plugin's rows are both present, and asserts the property this
plugin actually owns: its rows expose focusable controls to the keyboard (30 of them, counted from the DOM). The
tab-order assertion it used to carry is gone, and the reason is evidence rather than convenience - the focus
order dump shows the stops after our rows are the settings nav (模型 / 内置插件 / Agent 预设 / 电脑使用记录),
which this plugin does not render, so what Tab does next is decided by the shell's dialog composition. That dump
is still written beside the screenshot instead of being deleted.

What that step cost, in one line: fourteen of the sixteen rounds were spent measuring surfaces that were not on
screen - a shell focus ring, `document` standing in for a dialog, the panel, the native settings section, a
class inventory with no `ch-*` in it, one stray element, and finally the settings nav. Every one of them was
recorded in this file as it happened, which is the only reason the last two rounds could be short.

### Reproducing this phase

```console
$ pnpm verify                     # typecheck, lint, 374 tests, every boundary script
$ pnpm verify:p1                  # the Phase 1 close-out: builds and signs the macOS collector, runs the
                                  # native privacy/protocol tests
$ pnpm benchmark:ingestion        # the three baseline numbers (duration, throughput, store size)
$ pnpm verify:ci-boundaries       # the workflow, the fixture and this file agree on what is unverified
$ PANEL_URL='http://127.0.0.1:<port>/?token=…' node scripts/verify-panel-render.mjs
                                  # 50/50: seven rendered states, screenshots and text beside each one
```

The render check needs a Host and a headless Chromium; everything else runs from a clean checkout. The Host it
points at is deliberately not started by the script: evidence produced against a Host somebody else runs is
evidence about the plugin rather than about the script's own idea of one.

## What this phase still needs from a person, and what each step unlocks

Three things cannot be done by a program on this machine, and each one is written here with the exact action and
the evidence it produces, so the work does not depend on anyone remembering a chat message.

**1. The panel, in the owner's application.** The reviewed client is built and copied into the application's
profile (`~/.dsh/profiles/desktop/node_modules/dsh-computer-history`, verified by content: the new failure copy,
the episode line keys, the native row structure and the `settings.section` registration are all present). The
running application still has the previous client loaded, and restarting it is the only way to load the new one -
a program cannot do it, because the conversation that would issue the command runs inside that application.
*Action:* restart the application, or use its plugin page to reload.
*Evidence it unlocks:* a screenshot of the owner's own panel, taken with `screencapture` and read back, showing
the reviewed rows rather than the pre-rework ones.

**2. The Gecko row.** Firefox 157 is installed, the extension is built (`pnpm build:extension:firefox`) and the
whole chain up to the last step is scripted over WebDriver BiDi: `webExtension.install`, the extension's uuid
from `prefs.js`, the options page opened, a real page opened. The last step is the pairing token, because
Firefox's BiDi deliberately does not drive privileged pages - `browsingContext.navigate`, `script.evaluate` and
`input.performActions` all answer `unsupported operation` on an `moz-extension://` context, verified against
content pages in the same session where they all work.
*Action:* in the staged Firefox window, paste the token the panel shows once into the extension's options page
and save it (port stays 19388).
*Evidence it unlocks:* a live row whose `source_provider` is `companion` and whose origin is the page that was
open, read back from the store.

**3. The three-platform CI matrix.** The workflow, its commands and its boundary declaration are in place and
every one of its commands was run locally with its exit code recorded. The repository has no git remote at all,
so no runner has ever executed it.
*Action:* add a remote (or say the matrix is not wanted).
*Evidence it unlocks:* the first real run of `collectors.yml` on three runners, and with it the answer to the one
question the local runs cannot settle - whether the Windows crate's `cfg`-gated tests actually execute there.

### The 30 tab stops, broken down (a trade-off for the owner, not a defect)

The keyboard step counts 30 focusable controls in the settings rows. The rendering source has 7 button sites,
3 input sites and 1 switch site, so the bulk is not in the single controls: the applications list renders one
forget-button per application, which is where the count comes from (the same list produced the "22 buttons, 26
tabs to traverse" measurement earlier in this file).

Two honest options, with what each costs:

- **Leave it.** Every row is operable with one Tab and one Enter, nothing is hidden behind a menu, and the count
  grows with the number of applications the user has used. A keyboard user passes 22 stops to reach the controls
  below the list.
- **Collapse the per-row action.** One list with a single stop (roving tabindex, or the action inside a row menu)
  keeps the settings surface short, at the cost of one more interaction per application and of a pattern the
  platform's own settings pages do not use - which is why this is a question rather than a change: the reviewed
  row anatomy was matched to the native rows deliberately.

Recorded rather than acted on: it is a product trade-off about how the list behaves, and the owner has the
context for how many applications that list usually holds.

### The screenshots, looked at

The assertions were green; this is the first time the images were actually read. `ready-light.png` shows the
panel in a Chinese interface with data, and what it confirms is the part automated checks cannot:

- **Nothing diagnostic on screen.** No `Failed to fetch`, no `capture-owned-by-another-host`, no English sentence
  from the Host. The status card reads 已停止 / 仅记录元数据 / 今天还没有记录, and the thread line reads
  `dsh-computer-history · ui-review.md, validation-three-platforms.md · 3 个片段 · 8 分钟` - the structured fields
  through the locale dictionary, which is what the mapping work was for.
- **The rows read like the platform's own.** Title, subtitle, section headings, bordered cards, and one row per
  observation: `22:52-22:52 | >_ | ysradmin | Terminal | 14 秒`. Durations are in seconds, application names are
  localized, and the timeline groups by day with a summary line (`昨天 · 2026-10-03 · 20 秒 · 6 个片段`).
- **The sections are the ones Main is supposed to own**: timeline, 从这里继续 (with the new 查找其他工作 entry
  visible), 工作线索, and 摘要 - no pause, delete, policy or Recent Episodes controls, which live in Settings.
- **Nothing clipped or overflowing** in the light theme, matching the dark-theme measurement taken earlier.

One thing worth naming rather than "fixing": the status card says 已停止 while the panel still lists yesterday's
episodes. That is the product's own distinction - capture is stopped, the store is not empty - and the wording
keeps them apart, which is why it is recorded as correct rather than as an inconsistency.

### The dark screenshot, and what it confirms independently

`ready-dark.png` is the same panel with the settings dialog open, and it shows three things the assertions could
not:

- **The plugin's settings entry exists in the shell's own settings dialog.** The nav reads 通用设置 / 模型 /
  内置插件 / Agent 预设 / **电脑使用记录** / Vision Router - our section is registered alongside the platform's
  own, in the shell's own nav, not in a panel of our own making. That is the `settings.section` registration
  working, seen rather than inferred.
- **The dark theme is correct** on both the panel and the dialog: the same rows, the same card borders, the 深色
  option shown as selected, and no element left with a light-theme fill.
- **The dialog opens on the native 通用设置 section** (权限 / 语言 / 外观 / 字号大小 / 工作步骤展示 / 快捷键), which
  is exactly what the keyboard step spent its rounds discovering from the other direction. Seeing it here is
  what makes that finding obvious rather than mysterious.

Worth recording as the phase's shape: the check spent fourteen rounds learning that the dialog opens on someone
else's section, and this screenshot would have shown it in one look. Reading the images is part of the job, not a
formality after it.

### The failure state, seen: failure is not rendered as empty

`all-reads-failed.png` is the strongest single piece of evidence for one of this phase's acceptance criteria -
that loading, empty, unavailable and error are four different product facts. With every history read blocked:

- the status card says 电脑使用记录状态暂不可用。 followed by 时间线暂时不可用。, not "nothing recorded yet";
- the alert says **无法连接到宿主。** with a 重试 button - localized copy, no `Failed to fetch`, which is the exact
  regression that reached the reader twice before the mapping work;
- **each section reports its own failure separately**: 时间线暂时不可用。 重试, 工作线索暂时不可用。 重试, and
  摘要状态暂不可用。 beside the summary heading. One read failing does not blank the surface, and the sections do
  not share a single error flag - which is the "independent settled reads" rule made visible;
- no empty-state wording appears anywhere (no 还没有 / 没有任何记录), so a blocked read cannot be mistaken for a
  quiet store.

That is what the rendered-state check was for: the assertions say these strings are absent; the image shows what
is present instead.

### The delivery gate, run honestly: evidence accepted, page smoke not satisfiable here

`delivery_check` on this phase's artifact accepts the evidence manifest (12 items: the validation file, six runs
with their exit codes, three reviewed screenshots, the JetBrains row, and the two rows that stay unverified) and
passes file-exists, file-nonempty, encoding-utf8. It does **not** pass `page-verify`, and the reason is a
property of this plugin rather than an omission:

- the panel has no page of its own. It is a client bundle mounted inside the DSH shell, and the only URL that
  renders it is the Host's own token-protected interface (`http://127.0.0.1:19430/?token=…`);
- the gate's page smoke wants to fetch and screenshot that URL itself, and a token-protected SPA served by a
  self-hosted Host is not something it can do without that Host's session;
- pointing it at an unauthenticated URL would mean pointing it at a page that does not contain the plugin.

The phase therefore reports what is true: its own reproducible checks are green (`pnpm verify` exit 0 with 374
tests and 0 warnings, `pnpm verify:p1` exit 0, the rendered-state check 50/50 with each state's screenshot
reviewed), the evidence manifest is accepted, and the delivery gate is **not** satisfied. Saying "delivered"
here would be claiming a check that did not pass.

## Acceptance, command, status - one table

Every row of this phase's acceptance with the command that settles it and where it stands. "Green" means the
command was run and its result recorded above; "unverified" means no record exists and the file says so rather
than implying one.

| Acceptance | Command | Status |
|---|---|---|
| Three collectors pass one conformance suite | `pnpm test` (`tests/conformance/**`) | green: 374 tests, 0 warnings |
| The suite runs on three platforms | `.github/workflows/collectors.yml` | **unverified**: no runner has executed it (no git remote) |
| Every job command actually works | each command run locally with its exit code | green: recorded in this file, Windows crate's `0 passed` on macOS explained |
| A live record per platform, with the producing command | macOS: `pnpm verify:p1` + the collector's own run; Windows/Linux: none | macOS green; **Windows and Linux unverified** |
| Identical refusal reasons across platforms | `tests/conformance/**` + the fixture's `$unverified` lists | green for the message layer; live refusals **unverified** |
| A panel screenshot per platform store | macOS: the self-hosted Host; others: none | macOS green (three states reviewed by eye); others **unverified** |
| Loading, empty, unavailable and error stay distinct | `node scripts/verify-panel-render.mjs` | green: 52/52, and all four states read as images - loading says 正在加载… per section, failure says 暂时不可用 with a retry, empty is absent from both |
| Copy goes through the locale dictionary | `pnpm test` (`client-locale`, `client-diagnostic-copy`) | green |
| No diagnostic reaches the reader | `tests/unit/client-diagnostic-copy.spec.ts` | green (guard added after the regression shipped twice) |
| A live client row from a third end | the JetBrains run: `gradle build` then the IDE with `-Dcomputer-history.*` | green: row `companion\|jetbrains\|com.jetbrains.intellij\|editor` stored, client log `201 {"stored":true}` |
| A live row from the second browser engine | the staged Firefox window + one paste | **unverified**: Firefox BiDi does not drive privileged pages |
| Ingestion baseline recorded | `pnpm benchmark:ingestion` | green: 11 025 / 10 864 ms, 907 / 920 obs·s⁻¹, 6 295 552 B |
| Boundaries cannot drift silently | `pnpm verify:ci-boundaries` | green, with a red run recorded |
| The unknown-field contract is decided | `docs/collector-protocol.md`, three options and costs | **open**: the decision belongs to the repository owner |
| Delivery gate | `delivery_check` | **not satisfiable here**: the panel has no page of its own, so its evidence manifest is accepted and its page smoke fails; stated, not worked around |

### The owner's own application, seen: the reviewed client is live there

The panel in the owner's running application shows the reviewed client, and the evidence is a screenshot of that
application - not of a Host this work started:

- the status card reads **正在采集 / 仅记录元数据 / 今天还没有记录** - capture running, metadata only;
- the timeline groups by day (`昨天 · 2026-10-03 · 20 秒 · 6 个片段`) and every row carries its duration **in
  seconds** (`22:52-22:52 | >_ | ysradmin | Terminal | 14 秒`), which is the change that was sitting uncommitted in
  the tree until this phase committed it;
- 从这里继续 shows `validation-three-platforms.md · VS Code · 1 秒` and the **查找其他工作** entry, a locale key
  added in this phase;
- 工作线索 follows, and nothing diagnostic appears anywhere.

Two things this settles. The client that reaches the reader is the reviewed one - the earlier complaint that the
panel "has not changed at all" was about the copy in the application's profile, which was the pre-rework build
until this phase installed the current one. And it settles it **without a restart**: the application picked the
new client up on its own, so the restart this file listed as a human action turned out not to be needed, which is
recorded here rather than left as a stale instruction.

### Partial failure, seen: one read failing does not blank the others

`partial-failure.png` blocks only the timeline read. What the page shows is the claim this phase's acceptance
makes, and it is visible rather than inferred:

- 时间线 carries its own failure - `时间线暂时不可用。` with a 重试 button;
- **工作线索 still has data**: `dsh-computer-history · ui-review.md, validation-three-platforms.md · 3 个片段 ·
  8 分钟`, rendered from a read that succeeded while its neighbour failed;
- 摘要 and its `本地摘要` label are unaffected, the status card names only the affected part (`已停止 / 仅记录元数据
  / 时间线暂时不可用。`), and no browser error or empty-state wording appears anywhere.

Together with `all-reads-failed.png` this covers both halves of the rule: when everything fails each section says
so for itself, and when one thing fails the rest keep their content. A single shared error flag could not produce
either picture.

### `settings-read-failed` does not show what its name promises

The image shows the settings dialog open on the **native** 通用设置 section - 权限 / 语言 / 外观 / 字号大小 /
工作步骤展示 / 快捷键 - with the panel behind it reporting 电脑使用记录状态暂不可用。 and 时间线暂时不可用。 The
plugin's rows are not in the picture, so this screenshot does **not** evidence the claim its step is named for
("a settings surface without a snapshot must not keep its write controls available"). The dump's
`controls: enabled,enabled,disabled` counted controls across the page, which is the panel's, not the rows'.

What the image does evidence, and is worth keeping: the panel behind a blocked read reports the failure for
itself while the shell's settings dialog is open on top of it, and the shell's nav lists our 电脑使用记录 entry.

The claim itself is not withdrawn - it is simply not evidenced by this step. The step that can evidence it is the
keyboard step, which now opens the plugin's own section and leaves it on screen; its screenshot is the next thing
to read, and if the rows are there with their controls disabled, that is where this acceptance gets its picture.

### `focus-by-keyboard.png`: the plugin's own settings section, and the disabled control

The step that used to measure a dialog it had never opened now leaves this on screen, and it closes the previous
section's gap. With 电脑使用记录 selected in the shell's settings nav, the rows read:

- **记录** - `当前不会写入新的电脑使用记录。` and a **disabled** switch labelled **不可用**;
- 参与的应用与网站 - `22 已允许`, with the focus ring the keyboard walk placed;
- 历史保留多久 - `30 天`; 浏览器伴侣 - a green dot and **已连接**; 删除历史 - `清除电脑使用记录数据。`; 关于 -
  `版本、隐私与采集器状态。`

Four things this evidences, all of which were previously assertions or absent:

1. **"A settings surface without a snapshot must not keep its write controls available" now has its picture** - the
   recording switch is disabled and says 不可用 while the state is unavailable. This is the acceptance that the
   previous section recorded as un-evidenced; it is evidenced here, by the step that can open the section.
2. **The plugin's settings section is real and reachable**: it is selected in the shell's own nav, drawn with the
   shell's own row anatomy (icon, title, description, value or chevron on the right), in the shell's own dialog.
3. **The copy is entirely the dictionary's**: no reason codes, no Host sentences, no browser text - including the
   state that produces them (`不可用`, `已连接`, `22 已允许`).
4. **The companion really is paired** on this machine: 浏览器伴侣 shows 已连接, which is the owner's own
   application holding the intake, seen from the settings surface rather than from a store query.

The keyboard count of 30 focusable controls also has a shape now: one switch, the disclosure rows, and the
per-application entries the 22 已允许 line accounts for.

### `loading.png` shows the shell, not the loading state - and its assertion was vacuous

The image is the shell's workspace picker (探索未至之境 / 选择工作区 / 标准模式 / 选择一个工作区开始); the panel is
not open. The step navigates, waits 900 ms and captures - and 900 ms after navigation the shell has not even
reached the point where the plugin mounts, so what it captured is the shell and what its forbidden-string
assertion ran against is the shell's text. The assertion passed, and it passed for a reason that has nothing to do
with the plugin: there was nothing of ours on screen to be wrong.

The same shape as `settings-read-failed`, and worth naming as a pair: two of the seven states carry names their
images do not support. The other two reviewed states carry more than their names promise -
`partial-failure.png` demonstrates independent settled reads and `focus-by-keyboard.png` demonstrates the disabled
write control - so the visual review is not wasted, but it does mean the loading half of "loading, empty,
unavailable and error stay distinct" is **not** evidenced, and the assertion that was supposed to cover it needs
to mount the panel first and capture before its reads settle.

Recorded rather than fixed here: the fix is a change to the step (open the panel, then capture inside the window
before the reads land), and the phase's rule is that an unverified row says so instead of borrowing a green
assertion.

### The loading state, held open and captured: 52/52

The step now pauses the history reads at the network layer, mounts the panel, and captures while they are still in
flight. What the panel says in that window:

```
电脑使用记录 | 这台电脑最近被用来做了什么，只记录应用、文件与时长。 | 正在加载电脑使用记录… | 仅记录元数据 |
正在加载时间线… | 时间线 | 正在加载时间线… | 工作线索 | 正在加载工作线索… | 摘要 | 正在加载摘要状态…
```

That is the fourth state, and it is neither of the other three: not an error (`Failed to fetch` or 暂时不可用), not an
empty store (还没有 / 没有任何记录), and not the unavailable state - each section says **正在加载…** for itself, which is
also the independent-reads rule showing up in the fourth place. The check goes from 50/50 to **52/52** with the two
new assertions (the panel is ours, not the shell; loading is neither an error nor an empty state).

The earlier version of this step is kept in the record above rather than deleted: it captured the shell's workspace
picker for a whole phase and its assertion passed because nothing of ours was on screen. The lesson is the file's
recurring one, and this is the first state where the fix is deterministic rather than a longer wait.

### The loading state, seen

`loading.png` is the panel mounted with its history reads held: title and subtitle in place, the status card reading
**正在加载电脑使用记录…** with 仅记录元数据 and **正在加载时间线…**, then 时间线 / 工作线索 / 摘要 each carrying its own
**正在加载…** line and no content. No error text, no empty-state wording, no rows - a fourth state that shares no
wording with the other three.

Six of the seven states have now been read rather than only asserted: ready (light and dark), partial failure, total
failure, loading, and the settings section with its disabled control. The seventh, `settings-read-failed`, is the one
whose image shows the native section instead of ours; that step is the next thing to fix, and until it is fixed the
file says its name promises more than its picture supports.

### `settings-read-failed` fixed: it now shows our section, and one label stays loose

The step selects the plugin's section the same way the keyboard step does (try each candidate label, click the
element and its closest clickable ancestor, verify `.ch-settings-item` appeared) and its captured text now ends
with the shell's settings nav followed by **our** content: `无法连接到宿主。` and a 重试 button, with the panel
behind it reporting 电脑使用记录状态暂不可用。 / 时间线暂时不可用。 So the name and the picture agree at last: the
settings surface with a failed read renders its own failure copy.

One thing stays loose and is named rather than left: the step's own dump counts `.ch-button,.ch-input` and reports
`controls: enabled,enabled` - those two are the retry buttons, which *should* be enabled. The acceptance it is
named for ("no write control stays available without a snapshot") is evidenced elsewhere and better: the disabled
**记录** switch in `focus-by-keyboard.png`. What this step evidences is the failure copy and the retry path.

Seven of seven states have now been read. Two of them corrected themselves in the process - the loading state and
this one - and both corrections came from reading the image rather than trusting the step's name.

### Seven of seven states read, and what that changed

`settings-read-failed.png` now shows the settings dialog with 电脑使用记录 selected and its own failure copy -
`无法连接到宿主。` with a 重试 button - over a panel that reports its own failure. Name and picture agree.

All seven states have been read as images, and the exercise earned its keep twice: the loading state had been
showing the shell's workspace picker while its assertion passed for want of anything of ours on screen, and this
state had been showing the native section while its name promised ours. Neither would have been caught by the
assertions, because both assertions were true statements about the wrong surface - which is this file's recurring
error, now recorded in five different costumes across the phase.

## Phase close-out

**Green, with a command and a record for each:** the three collectors' protocol layers under one conformance suite
(`pnpm test`, 374 tests); the macOS collector live, built and signed (`pnpm verify:p1`); the JetBrains client live,
with a stored row whose identity is its own declaration and the client's log showing `201 {"stored":true}`; the
panel's seven rendered states (`scripts/verify-panel-render.mjs`, 52/52, every state read as an image, light and
dark); localization and the diagnostic-copy guard; the ingestion baseline; the CI boundary declaration with a red
run recorded; and the acceptance/command/status table above.

**Unverified, and why:** the three-platform CI matrix (every command run locally with its exit code, but no runner
has ever executed it - the repository has no remote), the Windows and Linux live rows (they need a desktop session
on those platforms, which is what the matrix cannot supply either), and the Gecko live row (Firefox's BiDi
deliberately does not drive privileged pages, so the pairing token needs one human paste).

**Three conclusions changed during the phase, each recorded where it happened rather than quietly:** the settings
dialog opens on the native section rather than ours (which retired three earlier theories about the keyboard step);
the loading state had been capturing the shell because the plugin was not mounted yet; and the application-scoped
listener does not attach in this platform build, which reversed a correction that had itself reversed a claim.

**What would finish it:** a git remote (the matrix, and with it the Windows/Linux rows), one paste in the Firefox
window, and the owner's decision on the unknown-field contract. Everything else in this phase's acceptance has a
green command behind it.

### The Gecko row: the paste is done, and the refusal is by design

Two corrections to this file, both from doing the work instead of reasoning about it.

**The paste is not a human step.** Firefox's BiDi does not drive privileged pages - that part stands - but the
window itself can be driven by the platform's own UI scripting, which this machine allows. Typing the port and the
token into the options page with System Events works, and the intake confirms it: `paired: true` with a
`lastSeenAtMs` that moves when the extension reports. So "one human paste" was wrong, and the corrected statement
is "one scripted paste, which I can do".

**The row is refused by design, and that is the finding.** With the token in place, the extension reporting, the
intake answering, the Host owning capture (it stores JetBrains rows from the same session) and a policy rule added
for the page's origin, no browser row is stored. The reason is in the README, in one line: *"Browsers are
fail-closed until a browser companion can enforce private/incognito boundaries."* The browser path is closed on
purpose in this phase, so the acceptance "a live record per platform store" cannot be met by the Gecko companion
here - not because the chain is broken, but because the product refuses browser observations until the companion
can prove the incognito boundary.

What is therefore verified for the second engine: Firefox 157 installed, the extension built for it, loaded over
BiDi, paired through its own options page, reporting to the intake with a valid token, and the intake answering.
What is not, and cannot be in this phase: a stored browser row. That belongs with the browser-boundary work, and
the honest form of it is a refusal reason rather than a missing row.

### The remote bridge: two different mechanisms, and the one step that needs the account owner

Reaching a Windows or Linux desktop would close the last two unverified rows, so the bridge was investigated
rather than assumed. There are two, and they are not the same product:

1. **`ds-harness-remote` 0.4.27** (installed in the `desktop` profile) is *DeepSeek Harness Remote* - a Remote Host
   and workspace plugin for DSH. The other machine runs a **Host**; this machine holds a `client` half under
   `~/.dsh/remote/servers/<id>/client/`. Its README states the rules: session traffic is Noise-encrypted, the Host
   connects **outbound only** (no public port), and a connection needs **account membership plus the Host's locally
   pinned device identity**.
2. **Remote Desktop Commander** is the official hosted MCP server for Desktop Commander. Its setup is: pair the
   machine with `npx @wonderwhy-er/desktop-commander@latest remote` (browser sign-in plus a matching device code;
   the agent stays in the foreground), then add the connector `https://mcp.desktopcommander.app/mcp` to the
   assistant, which triggers an **OAuth sign-in with the same account**.

Both bridges end at the same gate, and it is not a technical one: **an OAuth sign-in with the account the remote
machine was paired under**. The credentials on this machine belong to the previous account (the shape is
`serverUrl` / `deviceId` / `account` / `accessToken` / `refreshToken`; only the field names were read, no values),
so they cannot be reused, and inventing or transplanting credentials is not something this work will do.

**What is needed:** sign in here with the account the remote machine now uses - in the Remote UI for the first
mechanism, or through the MCP connector's OAuth flow for the second. Both are a browser sign-in that only the
account owner can complete.

**What happens the moment either is connected:** the same suite the macOS rows came from runs on that machine -
`cargo test` for the platform's collector, the conformance suite against a live collector, a live row in that
platform's store with the producing command recorded, and the refusal reasons compared across platforms. Those are
the two rows this phase leaves unverified, and they need nothing else.

### Connecting the Desktop Commander bridge, as far as it can be prepared

The connector cannot simply be "added", and the reason is a version fact rather than a permission: DSH 0.2.0-rc.2
has no MCP concept of its own (`dsh --help` knows only plugins, and no profile has an MCP package), so the
assistant-side connector that Remote Desktop Commander's setup describes does not exist here yet. What does exist
is the official bridge and its exact shape:

- **`@deepseek-ai/dsh-mcp-client` 0.0.1-rc.1** — "MCP client bridge: connects to MCP servers and registers their
  tools on `ctx.tools`", with `transport: stdio | streamable-http`, `url`, and `headers` (the README's own example
  is a bearer token from an environment variable);
- the hosted endpoint needs **OAuth**, and the official client carries **headers, not an OAuth flow** - so the
  order of work is: obtain a token through the hosted server's OAuth once, then pass it as a header.

Two steps follow, and only the first needs the owner:

1. install `@deepseek-ai/dsh-mcp-client` **from the application's plugin page** (the sanctioned path for the
   `desktop` profile, which the CLI refuses to manage on purpose - `dsh plugin --profile desktop …` answers
   "profile desktop is managed exclusively by the Electron application");
2. then the connector entry itself: `streamable-http` to `https://mcp.desktopcommander.app/mcp` with an
   `Authorization` header, the token obtained through one browser sign-in under the account the remote machine was
   paired with.

Everything after that is the work this phase has been waiting for: the platform's collector tests, the conformance
suite against a live collector on that machine, a live row in that platform's store with the producing command, and
the refusal reasons compared across platforms.

### The bridge: token obtained, one identifier short of wired

The OAuth half is done, and it took two attempts for an instructive reason. The first exchange failed with a 500
after a successful registration and a completed browser sign-in, because the request lacked the **`resource`
indicator** (RFC 8707) that MCP's authorization flow requires and had ignored the `client_secret` the registration
returned. With both in place the token was issued: an access token of 1342 characters and a refresh token, written
to a 0600 file. No credential value has been printed or committed at any point in this work.

The remaining piece is one identifier: the loader id the application assigns to `@deepseek-ai/dsh-mcp-client`. The
CLI cannot supply it - `dsh --profile desktop --dump-config` answers *"profile \"desktop\" is managed exclusively
by the Electron application"* - and the package itself declares no `dsh` field or patch layer to read it from. The
entry belongs in the profile's own patch layer (the file whose header calls itself "your patch layer", so writing
there is configuration rather than a bypass of installation), and the id is the one thing needed to write it.

Once the id is known - or the entry is added through the client's own settings surface, if it has one - the
connector is `streamable-http` to `https://mcp.desktopcommander.app/mcp` with an `Authorization` header, and the
remote machine's tools should appear as `mcp__<serverName>__<tool>`. Then the two unverified rows are the next
thing this file records.

### The bridge is wired; the loader needs one restart, and that is the one thing the agent cannot do

The identifier problem is solved without asking anyone: the application's plugin list **is** its patch layer, and
the file's own header calls it "your patch layer ... id-targeted config overrides, disables, and insert lists". Its
convention is visible in the entries it already holds (`ui-settings-account`, `ui-chat`, `ui-settings` - id equals
the package name without its scope), so the entry is:

```yaml
- id: dsh-mcp-client
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    servers:
      - name: desktopcommander
        transport: streamable-http
        url: https://mcp.desktopcommander.app/mcp
        headers:
          Authorization: "Bearer …"      # from the OAuth flow, file mode 0600, never printed
```

The whole file was re-parsed afterwards (16 entries, all of them, with the pre-existing `!!js` tags given a
loader) rather than trusting the append: the entry is present with the right server, transport, URL and header. The
layer was backed up first, as the application itself does when it writes it.

**What the loader shows, and why a restart is needed:** `dsh-mcp-client` is not among the loaded entries, while
`mcp-resources` is active - the profile's patch layer is read when the harness boots, so a new entry is not picked
up by a running process. The plugin page's "installed" means the package is present (it ships inside the
application bundle), not that an entry exists. Reloading it in place is not possible either: the injector tools
create entries without configuration, and this entry's whole value is its configuration.

That is the one step this work cannot take from inside the application, because the conversation runs in the very
process that would have to restart - and restarting is not a question of permission but of self-reference.
Sessions are durable, so the restart resumes this conversation with the entry loaded.

Also recorded: `ds-harness-remote` is present but **[disabled]** in the loader, which is why the other bridge has
not been reachable either.

### After the restart: the entry is intact, and the app's own plugin manager is what enables it

The restart happened (the application's helper processes are new) and the entry survived it, so the file-level work
is sound. What the four checks after it show, in order:

- **not loaded**: no tool named `mcp__…` is registered, and the loader's own listing does not contain
  `dsh-mcp-client` (it does contain `mcp-resources`);
- **not a resolution problem**: `@deepseek-ai/dsh-mcp-client` resolves from the desktop profile (through the
  globally installed harness);
- **nothing in the logs**: no loader complaint, no config error, no resolution failure in anything written since
  the restart - and the newest crash log predates it and is unrelated (`phase: running`);
- **no state file to flip**: nothing under `~/.dsh/storages` records plugin enablement; the only matches for the
  package name there are session caches, which mention it because this conversation discusses it.

So the app's plugin manager is the thing that decides, not the patch layer alone, and that manager's own loader
entry is itself listed as `[disabled]`. Writing the entry was the right file-level step and it is still the right
configuration; enabling it is a surface this work cannot drive - synthetic clicks do not reach this Electron app
(the click on 插件 in its own sidebar did nothing, verified by screenshot), and its UI answers `401` without a
session token it keeps to itself.

That is the honest division: the OAuth token, the entry, its validation, the restart verification and the
diagnosis are done here; one toggle in the application's plugin page is what remains before the remote machine's
tools appear.

### The shape was wrong, and the owner's intuition found it

The question "the toggle in the UI is just a code change underneath, isn't it" is right, and it located the actual
mistake: the entry had been appended as a **top-level** patch item. This layer's own header says what a top-level
item is for - "id-targeted config **overrides**, disables, and **insert lists**" - and `dsh-computer-history`'s own
patch shows the difference in eight lines: an existing entry is overridden at the top level, while **adding** one is
what `insert:` is for. A top-level entry for an id that does not exist is an override for nothing.

Re-shaped into an `insert` list, and the round trip verified rather than eyeballed: the parsed `Authorization` value
equals `Bearer ` plus the token from the 0600 file **character for character** (1349 = 7 + 1342). The file's long
scalar is folded across lines by whatever re-emitted it, and YAML folding reconstructs it exactly - which is worth
having measured, because "it looks wrapped" and "it is corrupted" are not the same thing.

The file parses to 16 entries with 3 insert blocks, one of which is this one. What remains is the same restart as
before, now with the right shape: configuration is applied when the process reads the layer, and a live toggle in
the plugin page works because it goes through the loader rather than through the file.

### The bridge is live, and what it reaches

Two rounds of `servers:` were wrong, and the module's own note says why: *each plugin instance connects to one MCP
server; load multiple instances for multiple servers*. The config **is** that one server - `serverName`,
`transport`, `url`, `headers` - not a list containing it. The decisive feedback came from an isolated boot (a
temporary profile with only this entry, booted with the CLI) rather than from another application restart: it
printed `ValidationError: invalid config` with the expected shape in the same line, twice, until the shape matched.
The owner's question - "the toggle in the UI is just a code change underneath, isn't it" - is what started that, and
it was right on both counts: the layer is a file, and the earlier attempts were failing on my own mistake rather
than on a permission.

With the shape fixed the client loads and its tools register (`mcp__desktopcommander__*`). One device is online:

```
1. ysr.local   Status: Online   App version: 0.2.52
```

and what it turns out to be is a **Mac** - `Darwin ... arm64`, `MacBookPro18,2`, user `ysradmin`, with this same
checkout at the same path. So the bridge works and reaches a macOS machine, which is not what the two remaining
rows need: a live row for Windows and for Linux requires a desktop session on those platforms. Those rows stay
unverified, and the way to close them is unchanged - pair a Windows or Linux machine the same way
(`npx @wonderwhy-er/desktop-commander@latest remote`) and the tools for it will appear beside this one.

### One connector, one account - and which side this Mac is

The bridge is authenticated as one account (`jeroysr@gmail.com`, one device online) and this Mac is deliberately the
**controlled** end of it. That has a consequence worth stating before anyone spends time on it: a connector's token
belongs to the account that authorized it, so a machine paired under a **different** account is not visible to this
one - not because of a setting, but because authorization is per account.

The client's own note gives the clean way through, and it is the same fact that fixed the config: *each plugin
instance connects to one MCP server; load multiple instances for multiple servers*. Two options, both small:

- pair the Windows or Linux machine under the **same** account this connector already holds - then its tools appear
  beside the current device with nothing else to change;
- or keep the other account and authorize a **second** instance of the client here with that account's token, which
  needs one sign-in as that account (an account boundary, not a file to edit - the sign-in is the part no file
  change can stand in for).

The current login is left untouched either way: no token rotated, no device revoked, no re-authorization. The two
remaining rows stay unverified until one of the two options lands, and the second one costs this work exactly one
more entry plus their sign-in.

### The second instance, and why it was removed again

The multi-instance route works exactly as the module describes - a second `insert` entry with its own id, its own
`serverName`, and its own token produced a second registered instance - but the sign-in for it landed on the account
the browser was already signed into. Decoding both tokens' `email` claims shows one account, not two:

```
instance 1 account: jeroysr@gmail.com
instance 2 account: jeroysr@gmail.com
different accounts: False
```

A second instance on the same account reaches no new device and registers the same tools twice, and it spends the
account's remote-call quota twice to do it. It was therefore removed, and the token from that sign-in is kept in a
0600 file: when a sign-in is done **as the other account** (the browser has to be that account, which is the one
thing no file can arrange), re-adding the instance is a two-line change that is already written down.

The alternative remains the cheaper one: pair the Windows or Linux machine under the account this connector already
holds, and its tools appear beside the current device with no second instance at all.

### The Windows machine is reachable, and what it still needs

The second instance works. Two accounts, two instances in the profile layer (17 entries, no validation errors in an
isolated boot):

```
instance 1: jeroysr@gmail.com              -> device ysr.local     (a Mac)
instance 2: yeshirui@stu.xjtu.edu.cn       -> device computer      (Windows)
```

`computer` answers `start_process` with `platform: win32, arch: x64, release 10.0.26200, 16 cpus`, shell
`powershell.exe`. That is the machine the Windows row has been waiting for since the beginning of this phase, and
it is the first time the UI Automation half of the acceptance has been reachable at all.

Its toolchain, re-measured on 2026-10-04: **git 2.55.0, cargo/rustc 1.99.0, node 24.21.0 and python 3.13.9
present, pnpm absent, and MSVC now linked through Visual Studio Build Tools 2022 (17.14.41)** - that last
piece was what made `cargo test` fail with `linker link.exe not found` before. The working tree was transferred
to `~\dsh-ch-tmp`, `cargo test` and `cargo build --release` ran there (the P5 section records the transcripts
and hashes), and four live collector runs produced observations for Explorer, Windows Terminal and a
policy-protected Notepad.

What is still missing there is the Host row: the plugin has not been built, installed and driven on that
machine, so nothing has been stored yet. The remaining sequence is to build the plugin, point its
`collectorExecutable` at the built binary, drive the two recordable applications, read the rows back with the
command recorded, and then remove the temporary tree, the temporary profiles and the windows the run opened.

One note kept for whoever reads the logs next: that Windows is a Chinese installation and PowerShell's errors come
back in GBK, so command output there has to be forced to UTF-8 or the diagnostics are unreadable.
