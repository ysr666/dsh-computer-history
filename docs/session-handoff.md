# Session handoff

> 中文摘要：本文是把 `dsh-computer-history` 三端收口工作交接给下一个 session 的唯一入口。当前状态：macOS 实机行已取证；Windows 机器已通过 Remote Desktop Commander 接入并在其上装好 git 与 Rust、仓库已投递（`~\dsh-ch-tmp`），下一件事就是在那里跑 `native/windows` 的 `cargo test` 与一致性套件并产出实机行。Linux 缺设备、三平台 CI 缺 git remote、Gecko 按产品设计 fail-closed，三项都写明"未验证 + 原因"。goal 工具在本环境只能 complete/blocked，无法 resume/create，这是环境限制而非停手理由。

## What the work is

`dsh-computer-history` at `/Users/ysradmin/Projects/dsh-computer-history` (branch `main`, TypeScript + pnpm +
vitest, zero runtime deps, **no git remote**). The objective is three-platform adaptation close-out: three
collectors, one conformance suite, a live record per platform, panel/localization, and the operational baselines.

Standing rules that outrank convenience: fix at the root (minimum by new concepts, not by changed lines); never add
a pipeline or fallback to make a red step green; no new capture capability (ADR 0002/0011); a row without a real
machine record says **unverified**; acceptance maps to a command; engineering records in English, user docs
bilingual; `pnpm verify` green with 0 warnings before every commit; read the gate's exit code, not its text; clean
up every process, window and temp directory started; **no release action** (tag, dispatch, version bump, merge)
without explicit authorization.

## Continuity semantics (2026-10-06)

`autoResume` and continuity evidence are deliberately separate. A top-level DSH turn checkpoint is metadata-only
(`sessionId`, turn, cwd/workspace and time) and is recorded only while Computer History itself is enabled and the
capture state is `running`. Pausing or degrading capture therefore stops checkpoint writes too. `autoResume` stays
default-off and gates only the experimental automatic Resume hint injection; a user-initiated Continue action or
`computer_history_resume` does not require that experimental switch. Editor-companion workspaces are vouched
workspaces and therefore anchor Episodes/Work Threads; this is covered end-to-end by
`tests/integration/work-continuity-loop.spec.ts`.

## Native Continue / Agent Work State contract (2026-10-06)

The primary Continue action now means **continue inside DSH**. Opening the recorded file/application is a separate
secondary action; older Phase 2B notes describing external-app reopening are historical implementation evidence,
not the current primary interaction.

The current continuation path is:

Episode evidence -> fresh DSH Session -> native @ Computer History ReferenceChipNode -> request-time hidden
system context -> Agent verifies authoritative workspace state -> continue.

The hidden context is intentionally not a prose summary. Maintain these invariants:

- User text outside the capsule is the specific instruction. A capsule with no additional text means "resume the
  recorded work"; the Agent should not make the user restate context when authoritative resources can be inspected.
- Workspace absolute root, newest trusted editor verification event, current Git probe timestamp/branch/HEAD/dirty
  shape, previous DSH checkpoint and HEAD movement are high-priority state. They must survive context-size trimming.
- Trusted historical editor saves and request-time Git dirty paths are distinct provenance channels. When they name
  the same canonical file, render the overlap as two independent signals (for example
  [observed-save + current-git .M]); never claim the current dirty state was caused by the recorded Episode.
- macOS /tmp and /private/tmp can name the same file. Resource/Git overlap matching resolves existing paths
  through filesystem metadata and falls back to lexical absolute paths for deleted/synthetic resources.
- Explicit Continue over one exact stored Episode uses that Episode's raw observationIds as the structured handoff evidence. summaryObservationIds are only a fallback for older/summary-only callers; missing summary citations must not erase otherwise auditable save/verification/resource provenance.
- Current Git state carries observedAtMs; "current" without a sampling time is not an auditable claim.
- Dynamic metadata is untrusted. Workspace titles, resource labels, URLs and window titles are flattened to one
  line and control characters are neutralized before entering system context.
- renderResumeHandoffContext() is budgeted, but Evidence + provenance + authoritative-source recovery guidance
  are non-droppable. Lower-priority lists are what get omitted.
- Computer History still records no task prompt and no file/document contents. The Agent recovers intent from the
  user's current instruction plus authoritative workspace state, not from guessed history prose.

Verification spans both halves: tests/integration/work-continuity-loop.spec.ts builds a real temporary Git
repository, ingests editor save/test events, advances HEAD, leaves a dirty file, then checks the final model
context. pnpm verify:continuation-capsule drives a real DSH 0.2.x browser client and proves the visible node is the
platform's native data-composer-chip="computer-history" reference with no hidden handoff text exposed in the page.

## Green, each with a command behind it

| Item | Evidence |
| --- | --- |
| Conformance suite for the three collectors' protocol layers | `pnpm test` — 374 tests |
| macOS collector live | `pnpm verify:p1` (TypeScript/privacy/build/native gate) |
| JetBrains client live | a stored row `companion\|jetbrains\|com.jetbrains.intellij\|editor`, client log `201 {"stored":true}` |
| Panel's seven rendered states | `node scripts/verify-panel-render.mjs` — 52/52, every state read as an image, light and dark |
| Localization + diagnostic-copy guard | `tests/unit/client-diagnostic-copy.spec.ts` |
| CI boundary declaration | `node scripts/verify-ci-boundaries.mjs` (red run recorded) |
| Ingestion baseline | 11 025 / 10 864 ms, 907 / 920 obs·s⁻¹, 6 295 552 B |
| Acceptance ↔ command ↔ status table | `docs/validation-three-platforms.md` |

## Unverified, with the concrete reason

- **Windows live row** — the machine is now reachable (below) and half-prepared; the row itself does not exist yet.
- **Linux live row** — no Linux device is paired. A desktop session is required (AT-SPI), which CI cannot supply
  either. Do not substitute a container and call it a live row.
- **Three-platform CI run** — every command has been run locally with its exit code recorded; **no runner has ever
  executed the matrix**, because the repository has no remote.
- **Gecko stored row** — product design, not a defect: README line 30, "Browsers are fail-closed until a browser
  companion can enforce private/incognito boundaries". Firefox 157 is installed, the extension is built, loaded
  over BiDi and paired (the pairing token was typed in by UI scripting; the intake answers `paired: true`), and no
  browser row is stored. Evidence it properly is a **refusal reason**, not a missing row.

## The remote bridge (how a Windows machine became reachable)

Two bridges exist and they are different products. `ds-harness-remote` (a DSH Remote Host plugin, present but
`[disabled]` in the loader) makes a machine reachable *as a Host*. **Remote Desktop Commander** is the one in use:
the official hosted MCP server, reached through DSH's official MCP client.

Facts worth not rediscovering:

- DSH 0.2.0-rc.2 has no MCP concept of its own; `@deepseek-ai/dsh-mcp-client` supplies it. Its tools appear as
  `mcp__<serverName>__<tool>`.
- The application's plugin list **is** `~/.dsh/profiles/desktop/cordis.patch.yml`, and a patch item is an
  id-targeted **override**; adding a plugin needs an **`insert:`** list (see `dsh-computer-history`'s own patch).
- The client's config **is** one server, not a list of them: `serverName`, `transport`, `url`, `headers`. Two rounds
  of `servers:` were wrong before an isolated boot printed `ValidationError: invalid config` with the expected
  shape. `serverName` (not `name`) is what the model sees in the tool name.
- **Editing the layer hot-reloads**: the entry disappeared and reappeared within one file write, so no application
  restart is needed once the shape is right.
- **Diagnose a config without restarting anything the user is using**: copy the entry into a temporary
  `DSH_HOME`, boot `dsh --profile <temp> --port <free> --no-open`, read the log, kill it. This loop found both
  mistakes in minutes.
- **Access tokens expire** (`expires_in: 3600`) and the client carries static headers only, so the bridge answers
  `Unauthorized` after an hour. Refresh with `grant_type=refresh_token` (body: `refresh_token`, `client_id`,
  `resource`), rewrite the entry's `Authorization`, done. Tokens live in 0600 files (`/tmp/dcc/token*.json`) and are
  never printed or committed.
- Two instances, two accounts (a token belongs to the account that authorized it):

| instance id | serverName | account | device |
| --- | --- | --- | --- |
| `dsh-mcp-client` | `desktopcommander` | `jeroysr@gmail.com` | `ysr.local` (a Mac) |
| `dsh-mcp-client-2` | `desktopcommander2` | `yeshirui@stu.xjtu.edu.cn` | `computer` (**Windows**) |

## The Windows machine, as measured

`computer` — `win32/x64`, release `10.0.26200`, 16 cpus, shell `powershell.exe`, **Chinese Windows** (PowerShell
errors arrive in GBK; force `[Console]::OutputEncoding=[Text.Encoding]::UTF8` or diagnostics are unreadable).

- present: Node `v24.21.0`, git `2.55.0.windows.5`, cargo `1.99.0` (git and Rust installed via winget this session,
  exit 0);
- absent: pnpm (use `corepack`/`npx` if needed);
- the repository was transferred as a tarball over the LAN from this Mac
  (`git archive HEAD` → `python3 -m http.server 19999 --directory /tmp` → `Invoke-WebRequest` on the Windows side)
  and extracted into **`~\dsh-ch-tmp`**, a directory created for this work. **Nothing outside it was touched**, and
  it must be deleted when the row is captured.

## Next steps, in order

1. `read_process_output` for the transfer PID; confirm `~\dsh-ch-tmp` holds the tree.
2. On Windows: `cargo test` in `native/windows` (and `native/collector-protocol`) — record exit codes verbatim.
3. Run the conformance suite against the live Windows collector; no substitutes.
4. Produce a **live row in that machine's own store** and record the exact command that produced it; compare refusal
   reasons with macOS.
5. Append all of it to `docs/validation-three-platforms.md`, move the Windows row from unverified to green (or leave
   it unverified with the reason).
6. Clean up: delete `~\dsh-ch-tmp` on Windows, kill the HTTP server on this Mac (port 19999), kill any temporary
   `DSH_HOME` hosts, leave no window open.

## Open items owned by the user, not by the agent

- **A git remote** (or an explicit "the matrix is not needed") — the only thing between here and a three-platform CI
  run.
- **A Linux device**, paired the same way (`npx @wonderwhy-er/desktop-commander@latest remote` there).
- **The unknown-field contract decision** for the collector protocol (three shapes, costs and calibration in
  `docs/collector-protocol.md`).
- **The settings list's 30 tab stops** (~22 are per-application 忘记 buttons) — both options and their costs are in
  the validation file.

## Lessons from this phase, kept because they were expensive

- **Five separate times, an assertion passed because it was measuring the wrong surface**: the shell's focus ring,
  `document` standing in for a dialog, `.ch-main` for the panel, the native settings section for ours, and a
  loading-state screenshot of the shell taken 900 ms after navigation (before the plugin had mounted). Every one was
  caught by **reading the image**, never by the assertion.
- **A conclusion was reversed twice in a row** about application-scoped listeners (first "they are not registered",
  then "the deprecated registration is honoured", finally: the project-scoped listener is the one that fires).
  Say which conclusion is being replaced and why, every time.
- **The user's own question found the last bug**: "the toggle in the UI is just a code change underneath, isn't it"
  is what turned a permission-shaped blocker into a config-shape mistake.

## Environment limits (not to be worked around)

- `update_goal` here supports **only** `complete`/`blocked`; `edit`/`pause`/`resume` answer *"require direct human +
  full adapter"*, and `create_goal` refuses while the blocked goal exists. The blocked goal
  `goal-2f962682-0f08-479a-8886-e693af701b52` therefore stays blocked. **This is a bookkeeping limit, not a reason to
  stop working.**
- `mark_task` (plan-tree calibration) is refused outside the Web-approved development phase.
- The panel has no page of its own, so the delivery gate's `page-verify` is not satisfiable for it; that is stated in
  the validation file and both READMEs rather than faked.
