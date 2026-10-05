# The first minute, recorded (T1.3) — 2026-10-05

`docs/plan-three-platforms.md` asks T1.3 for "the clean-store → first-row path with its commands and the row
itself", with the acceptance that "the record can be replayed by someone else from the commands alone", verified
by re-running it once on a fresh store. This is that record.

What it measures: how long a Host takes, from the moment it is launched against a store that has never recorded
anything, to the moment `/api/computer-history/recent` answers with its first row.

## The commands

```bash
# 1. one clean home, and the plugin installed the way the plugin manager installs it
export DSH_HOME=/tmp/dsh-home-fm
dsh plugin --profile fm add /tmp/fm-build/dsh-computer-history-0.1.0-dev.0.tgz
# 2. the interface half lives in its own bundle, and a profile made only by `plugin add` does not have it
dsh plugin --profile fm add @deepseek-ai/dsh-web-app@0.2.0-rc.2
#    (answer the build-script question the manager writes into profiles/fm/pnpm-workspace.yaml:
#     `allowBuilds: koffi: false`)
# 3. the collector, pointed at the desktop session it should observe (see "what a reader needs" below)
#    profiles/fm/cordis.patch.yml:
#      - id: computer-history
#        config:
#          enabled: true
#          collectorExecutable: '/tmp/dsh-http/linux-collector.sh'
#          companionPort: 19488
# 4. the timed proof itself
bash /tmp/fm-first-minute.sh fm 19500
```

The proof script wipes only `$DSH_HOME/computer-history`, boots the Host, exchanges the boot token for a session
cookie, applies the policy a Linux Host's first-run preset produces, and polls `/recent` until it is a non-empty
array.

## Run 1, then the same commands again on a second fresh store

| | run 1 | run 2 (the replay) |
| --- | --- | --- |
| clean store | yes | yes (deleted again) |
| boot → the API answers | 2136 ms | 2140 ms |
| policy applied | http 200 | http 200 |
| API answers → first row | **834 ms** | **832 ms** |
| **boot → first row** | **2970 ms** | **2972 ms** |

State right after the first row, both runs:

```json
{"enabled":true,"capture":"running","accessibilityTrusted":true,
 "collector":{"version":"0.1.0","arch":"arm64"},
 "companion":{"listening":true,"port":19488,"paired":false},
 "refusedByReason":{}}
```

## The row

```json
[{"id":"episode:linux-9831:1",
  "startedAtMs":1791167406544,"endedAtMs":1791167406544,
  "boundary":{"startReason":"first-observation","endReason":"timeout"},
  "summaryKind":"deterministic",
  "summary":"Recent computer activity.\n\nApplications: org.gnome.Nautilus.desktop",
  "summaryObservationIds":[1],
  "resources":[],
  "surfaces":[{"bundleId":"org.gnome.Nautilus.desktop","surfaceKind":"window","title":"Home",
               "firstSeenAtMs":1791167406544,"lastSeenAtMs":1791167406544,"observationCount":1}],
  "confidence":0.4,"state":"closed","observationIds":[1]}]
```

## The panel on the same clean store (T1.2's verify)

`CDP_PORT=19224 TARGET_URL_MATCH=19500 OUT_DIR=/tmp/dch-ui node scripts/panel-shot.mjs` reported
`opened: clicked` and two rows of geometry, and the frame is
`.debug/linux-2026-10-05/panel-first-minute.png`: one row, `Home` / Nautilus, with the health line green
("正在采集 · 仅记录元数据 · 今天 1 秒 · 1 个应用"). The row above was read back from `/recent` in the same run.

## What a reader needs in order to replay it, learned by getting it wrong first

* **macOS:** the collector needs the Accessibility permission *for the process tree that runs DSH*. A Host
  launched from a shell by an untrusted parent reports `capture: degraded`, `reason: collector-exited`,
  `accessibilityTrusted: false` and records nothing - which is the state a first-run user is guided out of by the
  panel. That attempt is why this record uses a Linux collector in a VM, where accessibility needs no grant.
* **The first-run preset belongs to the Host's platform.** `presetBundles(preset, process.platform)` expands it
  into that platform's ids, so a macOS Host driving a Linux collector sees macOS ids and the Linux application
  is outside the list. The command above applies the equivalent Linux policy by hand; a Linux Host's own preset
  produces it.
* **The companion port is fixed unless configured.** A second Host on the same machine conflicts with the
  running one on 19388; `companionPort: 19488` in the patch is what makes the state read `listening: true`.
* **A profile made only by `dsh plugin add` has no `@deepseek-ai/dsh-web-app` bundle**, and the panel waits
  forever on `connection`/`workspaceRegistry` with a single warning line
  (`1 entry did not activate`). A profile the application creates already carries it - the desktop profile on
  this machine does - so this is a property of the minimal profile, not of a normal install.
* **Stop the Host, not the shell that started it.** `cd /tmp && nohup dsh … &` makes `$!` the subshell, so the
  Host survives its killer; two leftover Hosts held ports 19500 and 19488 and every later boot failed with
  `EADDRINUSE` until they were found by their own command line and killed by PID.
* **A `configure` whose policy shape the collector does not recognise produces silence**, not a diagnostic:
  the correct shape is `{mode, allowedBundleIds, blockedBundleIds, protectedBundleIds, protectedPathPatterns}`.
  A Host always sends that shape, so this only bit a hand-written test harness - and it once looked like a
  collector defect for twenty minutes.
