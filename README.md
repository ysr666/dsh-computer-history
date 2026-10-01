# dsh-computer-history

Privacy-first Work Continuity for DeepSeek Harness.

This project is building a new DSH context source: recent work performed outside the current DSH Session, represented as metadata-backed Work Episodes that an Agent can query or selectively resume.

## Status

Phase 1 DSH-integrated alpha is implemented. It includes the local SQLite evidence store, deterministic Work Episodes and resume resolver, an event-driven macOS Accessibility collector, DSH-managed helper lifecycle, authenticated Host API, History/Privacy Client panel, Agent-scoped history tools, and an experimental one-shot ResumeHint that is off by default.

## Design boundary

The Phase 1 collector is metadata-only. It is designed to identify applications, resources, workspaces, timing, and privacy state without capturing screenshots, keystrokes, terminal contents, source-file contents, page bodies, or Accessibility text values.

## Technology

- TypeScript / Node.js ESM for Host, Agent, Client, shared contracts, tests, and tools.
- Swift for the macOS Accessibility collector.
- SQLite via Node for local persistence.
- pnpm for package management.
- Vitest + fast-check for tests.
- Oxlint for static linting.
- tsdown for TypeScript packaging.

See ARCHITECTURE.md, SECURITY.md, and docs/development.md before implementation work.


## Phase 1 defaults

Capture is off by default and app access is include-only. Browsers are fail-closed until a browser companion can enforce private/incognito boundaries. The packaged macOS collector is a universal arm64/x86_64 binary built by pnpm native:build. Run pnpm verify:p1 for the complete TypeScript/privacy/build/native gate.
