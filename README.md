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

## How this is verified, and what cannot be verified on this machine

`pnpm verify` (typecheck, lint, 374 tests and every boundary script) and `pnpm verify:p1` (the macOS collector,
built and signed, plus its native privacy and protocol tests) run from a clean checkout, and
`scripts/verify-panel-render.mjs` drives seven rendered states of the panel against a running Host, writing a
screenshot and the rendered text for each - run it with `PANEL_URL` pointing at a Host of your own.

Two things are deliberately **not** claimed. The three-platform CI workflow has every one of its commands run
locally with exit codes recorded, but no runner has executed it, because this repository has no remote. And the
panel has no page of its own: it is a client bundle mounted inside the DSH shell, so the only URL that renders it
belongs to a token-protected Host - which is why `delivery_check` accepts this project's evidence manifest and
still fails its `page-verify` smoke, and why that failure is stated rather than worked around.
