# Changelog

## Unreleased

- Complete the Phase 1 DSH-integrated alpha: SQLite evidence storage, deterministic Work Episodes and resume resolution, provenance-aware deletion/retention, Cordis ComputerHistoryService, event-driven macOS Accessibility collector, managed subprocess lifecycle, live privacy-gated ingestion, authenticated Host API, History/Privacy UI, Agent-scoped history tools, and opt-in experimental ResumeHint.
- Keep capture off by default, enforce include-only app policy, fail closed for browsers and protected/secure surfaces, and package a universal arm64/x86_64 macOS collector.
- Harden Phase 1 control and composition boundaries with revision-acknowledged native policy updates, pause-preserving crash recovery, lease-safe multi-Host ownership transfer, reconciliation heartbeat, strict Host API validation, conservative deletion provenance handling, and fail-closed resource canonicalization.
- Close the second hardening round: fail-closed secure-field detection for unreadable accessibility elements, protected-metadata screening across document/URL/identifier/window title at both layers, an accessibility messaging timeout, provenance completeness that can never certify an unlinked Episode, Episode aggregates derived from links instead of caller-supplied counters, ownership handover that is observable before `stop()` resolves, and a deduplicated database-closing teardown.
