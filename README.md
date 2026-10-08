<p align="center">
  <img src="assets/hero.svg" width="100%" alt="DSH Computer History — local-first metadata-only work continuity for DeepSeek Harness" />
</p>

<h1 align="center">dsh-computer-history</h1>

<p align="center"><strong>Pick up where you left off — with local, metadata-only work history for DeepSeek Harness.</strong></p>

<p align="center">Computer History turns app, resource, workspace and timing metadata into deterministic <strong>Work Episodes</strong>, so a DSH agent can understand recent work without reading the contents of your screen.</p>

<p align="center">
  <a href="https://github.com/ysr666/dsh-computer-history/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/ysr666/dsh-computer-history/ci.yml?branch=main&style=flat-square&label=CI" alt="CI" /></a>
  <a href="https://github.com/ysr666/dsh-computer-history/actions/workflows/collectors.yml"><img src="https://img.shields.io/github/actions/workflow/status/ysr666/dsh-computer-history/collectors.yml?branch=main&style=flat-square&label=collectors" alt="Collectors" /></a>
  <img src="https://img.shields.io/badge/status-early%20alpha-8A2BE2?style=flat-square" alt="Status: early alpha" />
  <img src="https://img.shields.io/badge/privacy-metadata--only-2EA44F?style=flat-square" alt="Privacy: metadata only" />
  <img src="https://img.shields.io/badge/storage-local%20SQLite-4D8CCB?style=flat-square" alt="Storage: local SQLite" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22.19%20%7C%2024-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22.19 or 24" />
  <img src="https://img.shields.io/badge/macOS-Accessibility-111111?style=flat-square&logo=apple&logoColor=white" alt="macOS Accessibility collector" />
  <img src="https://img.shields.io/badge/Windows-UIA-0078D4?style=flat-square&logo=windows&logoColor=white" alt="Windows UI Automation collector" />
  <img src="https://img.shields.io/badge/Linux-AT--SPI-FCC624?style=flat-square&logo=linux&logoColor=111111" alt="Linux AT-SPI collector" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat-square" alt="License: MIT" /></a>
</p>

<p align="center">English · <a href="README.zh.md">简体中文</a></p>

> [!NOTE]
> **Early alpha.** The core path is implemented and tested across the repository's three collector targets, but there is no stable packaged release yet. Installation and compatibility details may still change.

<p align="center">
  <img src="docs/assets/panel-timeline-duration.png" width="48%" alt="Computer History timeline in DSH" />
  <img src="docs/assets/panel-firstrun-clean-store.png" width="48%" alt="Computer History first-run privacy flow in DSH" />
</p>

<p align="center"><sub>Recent Work Episodes on the left; the first-run privacy flow on the right.</sub></p>

## Why this exists

A chat session knows what happened **inside the chat**. Your actual work often happens somewhere else: an editor, a terminal, Finder, a browser companion, or another desktop app.

Computer History is the missing continuity layer. It is built to answer questions such as:

- **What was I working on recently?**
- **Which project or resource was that work attached to?**
- **Where should I continue?**

The design goal is deliberately different from productivity surveillance. The project records enough local metadata to reconstruct useful work context, while refusing to turn the screen, keyboard or document contents into a history feed.

## At a glance

| | Computer History |
| --- | --- |
| **Storage** | Local SQLite; no remote history service required |
| **Model** | Deterministic observations → Work Episodes → selective resume context |
| **Collection** | Include-only, off by default, fail-closed on protected or uncertain surfaces |
| **Content boundary** | Metadata only — no screenshots, keystrokes, terminal output, source bodies or page bodies |
| **DSH integration** | Authenticated Host API, agent-scoped tools, History / Privacy panel |
| **Companions** | Browser and editor paths for metadata the OS cannot safely provide |

## How it works

<p align="center">
  <img src="assets/how-it-works.svg" width="100%" alt="Computer History pipeline: observe metadata, apply privacy policy, build local Work Episodes, offer resume context" />
</p>

The important property is what is **not** in that pipeline: screen pixels and document contents.

### Privacy boundary

| May be recorded when policy allows it | Designed never to record |
| --- | --- |
| application identity | screenshots or screen recordings |
| resource / workspace metadata | raw keyboard input or mouse coordinates |
| timestamps and duration evidence | clipboard contents |
| element role / identifier metadata | terminal output or shell history |
| privacy / protection state | source-file bodies |
| companion-provided safe resource metadata | browser page bodies |
| | Accessibility text values or selected text |

Capture starts **off**, application access is **include-only**, protected surfaces **fail closed**, and the Host re-screens metadata before storage. The exact guarantees, deletion model and residual risks live in [SECURITY.md](SECURITY.md) and [docs/threat-model.md](docs/threat-model.md).

## Platform status

| Platform | Collector path | Current status |
| --- | --- | --- |
| **macOS** | Accessibility | Packaged install + default collector handshake validated; native build/privacy/E2E gates remain green |
| **Windows** | UI Automation | Packaged install + default collector handshake validated; live Notepad → UIA → Host acceptance also green |
| **Linux** | AT-SPI | Packaged install + collector handshake validated; a real desktop session still needs its X/AT-SPI bus and permissions |

The shared collector contract is continuously checked on GitHub Actions across macOS, Windows and Linux. Live evidence and known limits are recorded in [docs/validation-three-platforms.md](docs/validation-three-platforms.md).

> [!IMPORTANT]
> The first public alpha is a **three-platform artifact**, not a macOS-only package. The release pipeline builds each
> native collector on its own OS, records its source commit and SHA-256, assembles all three into one plugin tarball,
> then clean-installs that same tarball on macOS, Windows and Linux without a `collectorExecutable` override.
> The installed client now also passes real first-run, Settings and successful History/Privacy browser checks on
> **all three platforms** ([measured evidence](docs/release.md)); macOS additionally passes a 52/52 full lifecycle
> journey. No public Alpha tag has been published yet; version, changelog and release preflight remain pending.

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

**Requirements**

- Node.js `^22.19.0` or `>=24`
- pnpm `11.7.0`
- Rust for Windows/Linux collector work
- Swift toolchain for native macOS work

For DSH integration, throwaway-host testing and platform-specific validation, see [docs/development.md](docs/development.md).

## Verification

```bash
pnpm verify                 # typecheck, lint, tests and architecture/privacy boundaries
pnpm verify:p1              # full macOS Phase 1 gate
pnpm e2e:macos              # throwaway DSH Host flow on macOS
pnpm e2e:linux              # Linux flow where the required desktop bus is available
pnpm benchmark:ingestion    # ingestion benchmark
```

Pull requests run Node 22 + 24 core verification, relevant cross-platform collector checks, and the native/performance gates when the changed paths require them.

## Documentation

| Start here | Deeper detail |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | [Collector protocol](docs/collector-protocol.md) |
| [Security & privacy](SECURITY.md) | [Three-platform validation](docs/validation-three-platforms.md) |
| [Development](docs/development.md) | [Threat model](docs/threat-model.md) |
| [Roadmap](docs/roadmap.md) | [Coverage decisions](docs/coverage.md) |

## Contributing

Issues and pull requests are welcome while the project is in alpha. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

> [!CAUTION]
> Because this project handles sensitive local context, **do not attach real history databases, pairing/session tokens, credentials, private paths, or unredacted capture logs to public issues**. Use the private vulnerability-reporting path described in [SECURITY.md](SECURITY.md) for sensitive findings.

## License

[MIT](LICENSE)
