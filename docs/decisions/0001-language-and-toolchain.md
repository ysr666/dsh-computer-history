# ADR 0001: Language and toolchain

Status: Accepted
Date: 2026-10-01

## Decision

Use TypeScript for DSH-facing code and Swift for the macOS native collector.

The TypeScript repository uses Node ESM, pnpm, Vitest, fast-check, Oxlint, and tsdown. The native collector uses SwiftPM.

## Rationale

DSH and Cordis are TypeScript-first, while macOS Accessibility, NSWorkspace, and related lifecycle APIs are native Swift/Objective-C APIs. Keeping the OS observer in a small Swift process avoids Node native-addon ABI coupling and keeps DSH semantics out of the collector.

## Consequences

Native/Host communication is an explicit versioned protocol. Cross-boundary data must be runtime validated.
