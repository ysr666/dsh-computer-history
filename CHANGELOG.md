# Changelog

## Unreleased

- No changes recorded since the v1.1.0 release candidate.

## 1.1.0

**Release candidate only — not yet tagged or published. Owner approval and exact-SHA release CI are required.**

- **M1 Work Memory:** retained and provenance-linked project history based on exact trusted Work Thread keys.
- **M2 confirmed notes:** explicit local save/edit/delete, export and separately approved restore; AI note reads require separate consent.
- **M3 Ask Your History:** on-demand natural-language-oriented evidence retrieval from retained work history.
- **AI-first query (Draft PR #168):** opt-in metadata-only bounded DSH
  history tool; `resource_text` together with file type/save/time
  filters refers to the **same saved resource**, not co-occurring events.
- **User-reviewed source → Continue (Draft PR #168):** editable, unsent
  AI question draft; explicit Episode source inspection and Continue,
  retained-source validation and duplicate-submit protection.
- **Migration 0016 (Draft PR #168):** Episode-retained facts proven by
  linked raw save/build/test observations. Previously expired events
  cannot be fabricated. Consistent backup and restore rehearsal are
  required; test/build is Episode-level, not per-file certification.
- **M4 Work Thread Intelligence:** advisory exact-file and time-nearby cross-application suggestions, without changing project identity or Continue ranking.
- **M5 Contextual Continue:** optional, current-session-bound project context from M1/M4; no automatic note exposure or first-turn expansion.
- **M6 Suggested Skills:** evidence-based repeated activity hints, not generated/installed/executed Skills.
- **M7 Suggested Automations:** user-reviewable recurring reminder drafts; no task scheduler, inferred clock time or unattended command execution.
- **Privacy hotfix:** strip sensitive browser URL titles/credentials/query/fragment; migration 0015 and legacy-backup import redaction retain Episode/citation provenance.
- **Release preflight:** read-only user-profile version/WAL inventory and documented consistent backup, isolated migration rehearsal and restore-based rollback plan.
- macOS isolated DSH 0.2.1-alpha.2 + Chrome installed product journey reached 59 verified assertions, including M6/M7 empty states; full cross-platform CI is a separate mandatory release gate.
- **Deployment limitation:** existing DSH 0.1.x profiles are not supported for in-place v1.1 without explicitly tested CLI/runtime upgrade. Never copy an active SQLite database file alone when WAL exists.

See [candidate release notes](docs/releases/v1.1.0.md).

## 1.0.1

**Published 2026-10-09.** The existing v1.0.1 tarball and tag are immutable.

- Add *explicit*, narrowly scoped peer compatibility for DeepSeek Harness `0.2.1-alpha.2` and Cordis `4.0.5-alpha.1`, without accepting unverified alpha versions or dropping DSH `0.2.0-rc.2` support.
- Verify the published v1.0.0 runtime unchanged against an actual isolated DSH `0.2.1-alpha.2` Host (55/55 end-to-end checks), including first-run policy, Browser/Editor privacy boundaries, evidence-complete Episode, native Continue, disable/re-enable and uninstall preservation.
- Teach the installed product journey to select its Host Web App independently of the stable default; isolate official npm Registry selection and **koffi-only** native-build approval to disposable alpha test profiles. Do not relax global pnpm or user profile build-script policies.
- Maintain the stable three-platform RC2 release gates; add a macOS Alpha 2 compatibility verification gate for candidate changes. Alpha 2 verification does not imply all desktop platforms or other alpha versions are supported.


## 1.0.0

**First public release candidate — not published until npm trusted publishing, three-platform release checks, and the explicit final sign-off succeed.**

- Launch the Continue-first Computer History client: recent work, evidence-backed Episodes, Timeline and project navigation. Create a native DSH session using the `@ Computer History` reference and a bounded agent continuation capsule without dumping raw history into the prompt.
- Add metadata-only Browser (Chromium and Firefox builds) and VS Code Editor Companions, with pairing, localized onboarding, fail-closed observation filtering, first-run consent, activity provenance and privacy-preserving origin/path normalization.
- Persist Work Threads, DSH checkpoints, activity evidence, summaries and verified continuation bindings in a local SQLite store with retention and deletion APIs.
- Enforce app allow plus typed browser-origin and vouched editor-workspace resource consent (All / Only selected / None). Deny/protect rules override allow. Prior users keep existing app-level scope on upgrade; strict mode is explicit.
- Provide deterministic summaries by default. Local/remote semantic summary providers require separate readiness and opt-in; sending a Continue handoff to a remotely configured DSH Agent can transmit the bounded task context to that model.
- Ship a single provenance-checked plugin tarball containing macOS, Windows and Linux collector binaries, with a real macOS 52-check installed lifecycle journey and three-OS packaged browser/client + collector clean-install matrix.
- Fix editor-pairing installation state races, enforce honest collector readiness states, protect icon paths, and avoid quadratic citation rewrites in long Episodes.
- **Compatibility:** tested with DSH 0.2.0-rc.2. Collector access is permission-dependent; a Linux runner without an X/AT-SPI session reports permission-required rather than pretending capture works. The v1.0.0 version number does not imply compatibility beyond the tested DSH 0.2.0-rc.2 or automatic schema rollback support.
- **Security:** history is stored locally, but SQLite is not separately encrypted; use OS disk encryption and filesystem access controls. An explicitly enabled remote model or Continue through a cloud-configured DSH Agent may transmit limited, consented context. This is not a 100% offline-only guarantee.

- Complete the Phase 1 DSH-integrated release: SQLite evidence storage, deterministic Work Episodes and resume resolution, provenance-aware deletion/retention, Cordis ComputerHistoryService, event-driven macOS Accessibility collector, managed subprocess lifecycle, live privacy-gated ingestion, authenticated Host API, History/Privacy UI, Agent-scoped history tools, and opt-in experimental ResumeHint.
- Keep capture off by default, enforce include-only app policy, fail closed for browsers and protected/secure surfaces, and package a universal arm64/x86_64 macOS collector.
- Harden Phase 1 control and composition boundaries with revision-acknowledged native policy updates, pause-preserving crash recovery, lease-safe multi-Host ownership transfer, reconciliation heartbeat, strict Host API validation, conservative deletion provenance handling, and fail-closed resource canonicalization.
- Close the second hardening round: fail-closed secure-field detection for unreadable accessibility elements, protected-metadata screening across document/URL/identifier/window title at both layers, an accessibility messaging timeout, provenance completeness that can never certify an unlinked Episode, Episode aggregates derived from links instead of caller-supplied counters, ownership handover that is observable before `stop()` resolves, and a deduplicated database-closing teardown.
