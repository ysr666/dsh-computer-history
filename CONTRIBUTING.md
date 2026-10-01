# Contributing

Read ARCHITECTURE.md, SECURITY.md, and docs/development.md before implementation work.

## Local setup

    corepack enable
    pnpm install
    pnpm verify

## Before opening a change

- Keep the change inside the current Phase/ADR scope.
- Add regression tests for behavior changes.
- Do not loosen privacy, lifecycle, deletion, or dependency-boundary gates.
- Update architecture/security documentation when the contract changes.

## Commit style

Use conventional, scoped subjects where practical, for example:

- feat(store): add initial schema migration
- fix(episodes): split on strong workspace switch
- test(native): cover secure-field metadata boundary
- docs(architecture): record browser companion deferral
