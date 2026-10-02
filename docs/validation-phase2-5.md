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
