# Quality: what the gate proves, and what it deliberately does not

`pnpm verify` is the contract this repository makes with itself. It runs seven
checks, and a check earns its place only if it can be shown to **fail**.

```text
pnpm check                     typecheck (strict, exactOptionalPropertyTypes) + lint (0 warnings)
pnpm test                      the suite
pnpm verify:privacy            forbidden APIs (screenshots, audio, keylogging, content reads)
pnpm verify:adapters           adapter evidence table, rows, sections, probes, bundle ids
pnpm verify:store-protection   store path permissions, non-synced location, FileVault
pnpm verify:semantic-boundary  network calls only in the two allowed senders, each gated
pnpm verify:architecture       contract layer has no implementation imports; no dead exports
pnpm verify:migrations         contiguous versions, unique names/checksums, rebuild integrity
```

## The rule that shapes all of them

**A check that cannot fail is not a check.** Every guard carries a self-check that
it still recognises the shape it exists to catch, asserted against a synthetic
sample - and a near miss that it must *not* flag:

| guard | self-check |
|---|---|
| adapters | a row that exists matches, the wrong adapter does not |
| privacy | `element.AXValue` is caught, `element.AXTitle` is not |
| store protection | a synced path is flagged, a private directory is not, a `0755` directory is |
| semantic boundary | `fetch(`, `this.fetchImpl(` and `doFetch(` all match |
| architecture | an escape import matches, an in-layer import does not; a name used nowhere counts as dead |
| migrations | the version reader reads a version and not a name; the rebuild detector sees `DROP TABLE` and not `CREATE TABLE` |

That rule is not theoretical here. It was written after a guard reported
"1 network call, all in local-provider.ts" **while two files were sending**, and
after a guard script that did not parse was committed and passed silently.

## What the gate does not prove

Stated deliberately, because a gate that implies more than it checks is worse than
a smaller one:

- **Not coverage.** There is no coverage threshold. A percentage rewards testing
  trivia and says nothing about whether the important paths are exercised.
- **Not behaviour.** The tests assert contracts and evidence; they do not prove
  the collector reads the right Accessibility attribute on a machine nobody has
  booted. That is what `docs/validation-*.md` records are for.
- **Not the Host-managed start of a packed bundle.** Assembling a profile bundle
  happens at Host startup; what the gate proves is that the build output applies
  and registers its routes (`tests/integration/packaged-entry.spec.ts`). The
  difference is in `docs/release.md`.
- **Not that a guard's rule is the right rule.** The architecture guard's first
  version wanted to delete seven live exports; the calibration showed the check
  was too crude, not the code. Self-checks prove discrimination, not wisdom - a
  human still has to look at what a red gate is claiming.
- **Not performance.** `pnpm benchmark:ingestion` exists and is not a threshold.

## How a change is judged here

1. A defect gets a test that **fails first**, and the test is kept.
2. A guard that cannot fail gets a self-check before it gets more rules.
3. A rule derived from the sources beats a rule somebody has to remember.
4. A measurement beats a document: when they disagree, the document changes.
5. When the evidence does not settle it, the claim is downgraded and the next
   probe is named - see the tarball install in `docs/release.md`.
