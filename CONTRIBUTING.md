# Contributing

Thanks for helping improve `dsh-computer-history`.

Before implementation work, read [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), and [docs/development.md](docs/development.md). Privacy and deletion guarantees are product contracts, not optional implementation details.

## Before opening an issue

- Search existing issues first.
- Use the bug or feature-request template when possible.
- Redact usernames, private paths, project names, URLs, tokens and credentials from logs.
- **Never upload a real Computer History database or unredacted capture dump to a public issue.**
- Report security-sensitive findings through GitHub Private Vulnerability Reporting instead of a public issue.

## Local setup

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm verify
```

Platform-specific work may also need Rust, Swift, a real desktop session, or the commands documented in [docs/development.md](docs/development.md).

## Pull requests

Keep PRs focused and make the evidence easy to inspect.

- Add regression tests for behavior changes.
- Do not loosen privacy, lifecycle, deletion, or dependency-boundary gates to make a test pass.
- Update architecture/security documentation when a contract changes.
- For collector/platform changes, state which parts were tested on a real platform and which were only exercised through conformance tests.
- Keep English/Chinese user-facing documentation in sync where the repository's documentation gate requires a pair.
- Run `pnpm verify` before requesting review. Run the relevant native/E2E gate when your change touches that path.

## Commit style

Use conventional, scoped subjects where practical, for example:

- `feat(store): add initial schema migration`
- `fix(episodes): split on strong workspace switch`
- `test(native): cover secure-field metadata boundary`
- `docs(architecture): record browser companion deferral`
