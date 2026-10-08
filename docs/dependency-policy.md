# Dependency and DSH Host compatibility policy

Computer History follows the DSH Vision Router model: prioritize verified Host
compatibility and security fixes over automatic npm version churn.

- **Host-owned dependencies:** React is provided by DSH. The current verified
  contract is React 18 (plugin peer `^18.2.0`); do not upgrade the plugin
  development runtime or `@types/react` to React 19 in isolation.
- **DSH packages:** Development dependencies use one exact verified family,
  currently `0.2.0-rc.2`. Published peer ranges admit that family through
  pre-0.3 versions, but a wide declared range is **not proof** of runtime
  compatibility. Test new Hosts before raising the version floor.
- **Node and TypeScript:** Support Node 22.19+ and Node 24+; keep
  `@types/node` on the Node 22 baseline until the minimum runtime changes.
  Treat TypeScript major upgrades as explicit migrations.
- **Dependabot:** Ordinary npm version update PRs are disabled
  (`open-pull-requests-limit: 0`), following DVR. Dependabot security updates
  remain eligible **if enabled in GitHub repository settings**. GitHub Actions
  version updates remain weekly.
- **Security:** Dependency Review rejects newly introduced known vulnerabilities
  of moderate severity or higher during PR review. Security fixes may need a
  repository-owned patch that preserves the Host's peer version contract.
- **Verification:** `tests/dependency-contract.spec.ts` prevents accidental
  dependency-family and React/Node/TypeScript drift. Before a deliberate tooling
  upgrade, run `pnpm build`, `pnpm verify`, and packaged/real-Host tests.
  Release acceptance separately gates the assembled plugin's product journey
  and Continue path; ordinary unit tests alone are insufficient.

When the DSH stable/preview Host changes, inspect the Host's dependency
contracts and its installed behavior; update this policy, the manifest,
the dependency-contract test, and the verified Host fixture together.
Do not loosen compatibility assertions merely to make a dependency PR green.
