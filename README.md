# dsh-computer-history

Privacy-first Work Continuity for DeepSeek Harness.

This project is building a new DSH context source: recent work performed outside the current DSH Session, represented as metadata-backed Work Episodes that an Agent can query or selectively resume.

## Status

Phase 1 implementation is beginning. The repository is intentionally initialized before feature code so architecture, privacy, testing, and release rules are stable from the first implementation commit.

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
