# Phase 2.5 runtime validation

Companion to `docs/plan-phase2-5.md`. One section per task, evidence first.
Boundaries: ADR 0002 (metadata-only), 0007 (companion trust boundary),
0009 (editor companion boundary, written this phase).

## T2.5-0 — spike

```text
VS Code            1.140.0 (arm64), commit 07f806f999227108933c2e30515b26eecc1fda74
CLI                runs only with ELECTRON_RUN_AS_NODE cleared, as Phase 1 found
existing payload   { origin, path, title?, incognito, browserSession, seq, observedAtMs }
existing mapping   { provider: 'companion', adapter: 'browser' }, url = origin + path
```

Two consequences: the payload needs a source kind before an editor can send
anything, and the mapping has to branch rather than assume a URL. One open item
for T2.5-3: the app bundle's `Resources/app/bin/` did not list a `code` shim, so
the `.vsix` install path has to be established before the live run (GUI "Install
from VSIX" is the fallback).

## T2.5-1 — ADR 0009

`docs/decisions/0009-editor-companion-boundary.md` (Accepted). One intake, two
disjoint shapes; contents unrepresentable by type and by validator; a vouched
root checked for coherence; per-workspace consent reusing the existing
`resource` dimension; and a new `workspace_source` value, because an editor's
vouch is neither an inference from a path (`filesystem`) nor the Host's own
workspace (`dsh`) and recording it as either would misstate how the Host knows.

## T2.5-2 — payload union, validation and mapping

`CompanionPayload` is now `BrowserCompanionPayload | EditorCompanionPayload`, and
the type system did the work of finding the callers: the incognito guard and the
observation mapper both had to say which shape they meant.

```text
pnpm test tests/unit/companion-intake.spec.ts tests/unit/companion-observation.spec.ts
  → 19 passed

editor cases added:
  a valid editor payload answers 201 and delivers the workspace root
  a payload carrying { text: 'secret document body' } is refused:
    "unknown field for an editor payload: text"
  browser fields on an editor payload, and editor fields on a browser payload,
    are both refused
  a filePath outside the workspaceRoot it claims is refused:
    "filePath must live under workspaceRoot"
  a payload with no source kind is refused
```

The `text` case is the phase's headline guarantee, and it is a property of the
shape rather than of the extension's good behaviour: there is no field a document
body could occupy, and unknown fields are refused instead of ignored.

The existing tests failed first because their payload builder predated the
`source` field — the right direction for them to fail in, since the field is part
of the contract now and the extension must declare it.

Still open in this task: the vouched workspace root does not yet reach the stored
observation. That needs the `workspace_source` widening (migration) and the
observation-level workspace override, and it is the next round's work.

### T2.5-2, finished: the vouched root reaches the store

`observations.workspace_source` gains `'companion'` (migration 0006, which
rebuilds `observations` for the widened CHECK through the runner's
`rebuildsReferencedTable` path; the frozen-v1 upgrade test exercises it), the
store's validator accepts the value, `NativeObservation` gains an optional
`workspace`, and ingestion honours that field **only** when
`source.provider === 'companion'`.

```text
pnpm test tests/integration/companion-workspace.spec.ts → 3 passed

a vouched root is stored as { source: 'companion', confidence: 1, root }
an Accessibility observation claiming a workspace is ignored: the resolver's
  inference ('filesystem', '/inferred') is what gets stored
two editor observations produce an episode and leave
  workspace_source='companion' with the vouched root
```

The second case is the one that matters directionally: the vouch is a
*capability* of the paired companion, not a field any observation may fill in.

**A design decision taken while writing it.** The editor observation carries VS
Code's **real** bundle id, not the synthetic `companion.browser` the browser path
uses. The extension runs inside the editor, so that is the truthful answer, and
it means the rule the user already has for "allow VS Code" governs it instead of
a second thing to allow. A future editor-agnostic companion whose extension
declares its own identity is a boundary decision for its own ADR; ADR 0009 now
records the distinction.

**Two of my own mistakes, both found by running the tests:**

- the fixture dated its observations one second in the future
  (`observedAtMs: now + seq * 1000`), and ingestion refuses a future observation
  by design. The pure-function probe accepted the same message because it does
  not consult a clock, which is what pointed at the fixture rather than the code;
- the store's validator never got the new value: a `str.replace` in an earlier
  edit targeted a string that did not match (the line begins with `||`), and it
  failed **silently** because that particular patch had no assertion. It has one
  now, and the failure then read `invalid workspace source: companion` - the
  error doing its job.
