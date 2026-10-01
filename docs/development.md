# Development

## Required toolchains

- Node.js ^22.19.0 or >=24
- pnpm 11.7.0
- TypeScript 6
- Swift toolchain for native macOS work

## Core commands

    pnpm install
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm verify

Native commands are introduced when the SwiftPM package is added:

    pnpm native:build
    pnpm native:test

## Development order

Follow ARCHITECTURE.md, SECURITY.md, docs/development.md, and the Phase 1 Implementation Spec. Contracts, store, and deterministic core are built and reviewed before native, UI, and automatic resume integration.

## Local data

Never use real personal Computer History as a normal test fixture. Unit and integration fixtures must be synthetic. Live AX output stays under ignored local directories and must be reviewed before sharing.
