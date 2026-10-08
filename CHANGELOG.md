# Changelog

## Unreleased

- No changes recorded after the Alpha candidate.

## 0.1.0-alpha.1

**First public Alpha candidate — not published until the final signed-off release tag.**

- Launch the Continue-first Computer History client: recent work, evidence-backed Episodes, Timeline and project navigation. Create a native DSH session using the `@ Computer History` reference and a bounded agent continuation capsule without dumping raw history into the prompt.
- Add metadata-only Browser (Chromium and Firefox builds) and VS Code Editor Companions, with pairing, localized onboarding, fail-closed observation filtering, first-run consent, activity provenance and privacy-preserving origin/path normalization.
- Persist Work Threads, DSH checkpoints, activity evidence, summaries and verified continuation bindings in a local SQLite store with retention and deletion APIs.
- Enforce app allow plus typed browser-origin and vouched editor-workspace resource consent (All / Only selected / None). Deny/protect rules override allow. Prior users keep existing app-level scope on upgrade; strict mode is explicit.
- Provide deterministic summaries by default. Local/remote semantic summary providers require separate readiness and opt-in; sending a Continue handoff to a remotely configured DSH Agent can transmit the bounded task context to that model.
- Ship a single provenance-checked plugin tarball containing macOS, Windows and Linux collector binaries, with a real macOS 52-check installed lifecycle journey and three-OS packaged browser/client + collector clean-install matrix.
- Fix editor-pairing installation state races, enforce honest collector readiness states, protect icon paths, and avoid quadratic citation rewrites in long Episodes.
- **Compatibility:** tested with DSH 0.2.0-rc.2. Collector access is permission-dependent; a Linux runner without an X/AT-SPI session reports permission-required rather than pretending capture works. This Alpha has no stable compatibility or schema rollback guarantee.
- **Security:** history is stored locally, but SQLite is not separately encrypted; use OS disk encryption and filesystem access controls. An explicitly enabled remote model or Continue through a cloud-configured DSH Agent may transmit limited, consented context. This is not a 100% offline-only guarantee.

- Complete the Phase 1 DSH-integrated alpha: SQLite evidence storage, deterministic Work Episodes and resume resolution, provenance-aware deletion/retention, Cordis ComputerHistoryService, event-driven macOS Accessibility collector, managed subprocess lifecycle, live privacy-gated ingestion, authenticated Host API, History/Privacy UI, Agent-scoped history tools, and opt-in experimental ResumeHint.
- Keep capture off by default, enforce include-only app policy, fail closed for browsers and protected/secure surfaces, and package a universal arm64/x86_64 macOS collector.
- Harden Phase 1 control and composition boundaries with revision-acknowledged native policy updates, pause-preserving crash recovery, lease-safe multi-Host ownership transfer, reconciliation heartbeat, strict Host API validation, conservative deletion provenance handling, and fail-closed resource canonicalization.
- Close the second hardening round: fail-closed secure-field detection for unreadable accessibility elements, protected-metadata screening across document/URL/identifier/window title at both layers, an accessibility messaging timeout, provenance completeness that can never certify an unlinked Episode, Episode aggregates derived from links instead of caller-supplied counters, ownership handover that is observable before `stop()` resolves, and a deduplicated database-closing teardown.
