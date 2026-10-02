# Summaries

An episode answers "what was I doing" in two layers: text that is computed
locally from stored observations, and — only if you ask for it — text written by
a model. Which layer produced a summary is stored with it, and every summary
carries the observation ids it was derived from (ADR 0004 §5).

## The default: deterministic, local, always on

`deterministic` summaries are a function of the episode's own observations:
workspace, resources, applications, counts. They add no disclosure, so they are
on by default and there is nothing to configure.

## A model, when you want one

Every summary states its `summaryKind`: `deterministic`, `local` or `remote`.

- **`local`** — a model on this machine. Nothing leaves the device, so a scope
  may use one without asking; the panel shows `Local model: configured` once one
  is. The provider speaks Ollama-compatible HTTP on **loopback only**: a
  non-loopback endpoint is refused in `assertLoopbackEndpoint`, and
  `verify:semantic-boundary` fails the build if any other file under
  `src/host/semantic/` can open a connection.
- **`remote`** — a model over the network. Off by default, forever, and it can
  only run for a scope where a permission has been **recorded** in
  `semantic_opt_ins`; `assertRemoteOptIn` throws otherwise. Before you grant it,
  `GET /semantic/preview?scope=…` shows the exact payload that would be sent.

`pnpm verify` runs the boundary guard, so the promise is checked on every build:

```text
semantic boundary holds: 1 network call(s), all in local-provider.ts, all loopback-checked
```

## What a model is allowed to see

`minimiseEpisode` keeps shape and drops identity. From an episode holding
`file:///Users/you/Projects/client/src/billing.ts?token=…`, an internal URL with
an id and a title that names the file, a provider receives:

```json
{"appBundleIds":["com.google.Chrome","com.microsoft.VSCode"],
 "surfaceKinds":["browser","editor"],"resourceKinds":["file","url"],
 "fileExtensions":["ts"],"observationCount":2,"startHourOfDay":9,
 "durationMinutes":90,"workspaceRootName":"client","hasThread":true}
```

No full path, no file name, no host, no query string. The workspace root
**basename** stays, which ADR 0004 §4 explicitly allows.

## Turning it off

The panel's **Summaries** section lists every scope that uses a model, with two
actions per scope:

- **Preview payload** — the same bytes a provider would see, computed by the
  same minimiser.
- **Turn off and purge** — removes the recorded permission and deletes the
  model-written summaries for that scope. Deterministic text is untouched: it
  never left the machine, so there is nothing to withdraw.

Deleting *evidence* is separate and stricter: `episode_summary_citations` has
`ON DELETE CASCADE` on both sides, so removing an observation removes the
citation, and an episode whose citations are gone cannot back a thread or a
resume hint. `pnpm test` pins both directions.

## Where it lives

| Piece | File |
|---|---|
| What a provider may see | `src/host/semantic/minimise.ts` |
| Provider interface, loopback rule | `src/host/semantic/provider.ts` |
| Local model (Ollama-compatible) | `src/host/semantic/local-provider.ts` |
| Per-scope permission, purge | `src/host/semantic/opt-in.ts` |
| Citations, threads, hints | `src/host/episodes/threads.ts`, `src/host/resume/resolver.ts` |
| Boundary guard | `scripts/verify-semantic-boundary.mjs` |
