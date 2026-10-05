# dsh-computer-history

[![CI](https://github.com/ysr666/dsh-computer-history/actions/workflows/ci.yml/badge.svg)](https://github.com/ysr666/dsh-computer-history/actions/workflows/ci.yml)
[![Collectors](https://github.com/ysr666/dsh-computer-history/actions/workflows/collectors.yml/badge.svg)](https://github.com/ysr666/dsh-computer-history/actions/workflows/collectors.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Privacy-first computer history and work continuity for DeepSeek Harness.**

[简体中文](README.zh.md)

`dsh-computer-history` turns recent computer activity into local, metadata-backed **Work Episodes** that a DSH agent can inspect and selectively resume. The goal is not productivity surveillance: it is to help an agent answer “what was I working on, and where should I continue?” without recording the contents of your screen.

> **Status:** early alpha. The core path is implemented and tested, but there is no stable release yet. Installation and compatibility details may still change.

<p align="center">
  <img src="docs/assets/panel-firstrun-clean-store.png" alt="DSH Computer History first-run panel" width="820" />
</p>

## What it does

- Stores recent activity locally in SQLite.
- Groups observations into deterministic Work Episodes.
- Exposes recent work to DSH through an authenticated Host API and agent-scoped tools.
- Provides a History / Privacy panel for capture policy, retention, recent episodes and resume.
- Supports browser and editor companion paths for applications where OS metadata is not enough.
- Keeps collection policy explicit, include-only and fail-closed.

## Privacy boundary

The project is deliberately **metadata-only**.

It may record application identity, resource/workspace metadata, timing, element role/identifier metadata and privacy state when policy allows it.

It is designed **not** to record:

- screenshots or screen recordings;
- keystrokes, mouse coordinates or clipboard contents;
- terminal output or shell history;
- source-file bodies;
- browser page bodies;
- Accessibility text values or selected text.

Capture starts off, application access is include-only, protected surfaces fail closed, and the Host re-checks metadata before storage. See [SECURITY.md](SECURITY.md) and [docs/threat-model.md](docs/threat-model.md) for the exact boundary and residual risks.

## Platform status

| Platform | Collector path | Current status |
| --- | --- | --- |
| macOS | Accessibility | Primary path; native build, privacy tests and end-to-end flow validated |
| Windows | UI Automation | Live collector + Host flow validated on Windows 11 |
| Linux | AT-SPI | Collector/protocol path live-validated on Ubuntu; desktop/permission availability still matters |

Cross-platform validation evidence and known limitations are recorded in [docs/validation-three-platforms.md](docs/validation-three-platforms.md).

## Development quick start

There is no stable packaged release yet, so the supported entry point today is a source checkout.

```bash
git clone https://github.com/ysr666/dsh-computer-history.git
cd dsh-computer-history
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm verify
```

Requirements:

- Node.js `^22.19.0` or `>=24`
- pnpm `11.7.0`
- Rust for Windows/Linux collector work
- Swift toolchain for native macOS work

For DSH integration, throwaway-host testing and platform-specific validation, use [docs/development.md](docs/development.md).

## Verification

Useful gates include:

```bash
pnpm verify                 # typecheck, lint, tests and architecture/privacy boundaries
pnpm verify:p1              # full macOS Phase 1 gate
pnpm e2e:macos              # throwaway DSH Host flow on macOS
pnpm e2e:linux              # Linux flow where the required desktop bus is available
pnpm benchmark:ingestion    # ingestion benchmark
```

GitHub Actions also runs the core Node compatibility gate and the relevant cross-platform collector checks.

## Documentation

- [Architecture](ARCHITECTURE.md)
- [Security & privacy](SECURITY.md)
- [Development](docs/development.md)
- [Collector protocol](docs/collector-protocol.md)
- [Three-platform validation](docs/validation-three-platforms.md)
- [Roadmap](docs/roadmap.md)

## Contributing

Issues and pull requests are welcome while the project is in alpha. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

Because this project handles sensitive local context, **do not attach real history databases, pairing/session tokens, credentials, private paths, or unredacted capture logs to public issues**. Use the security-reporting path in [SECURITY.md](SECURITY.md) for sensitive findings.

## License

[MIT](LICENSE)
