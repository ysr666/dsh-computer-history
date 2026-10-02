# ADR 0009: The editor companion boundary

Status: Accepted
Date: 2026-10-02
Accepted by: project owner (asked for the editor companion before remote models)

## Context

ADR 0007 gave the browser a trusted side channel: a plugin-owned loopback
listener, a pairing token stored as a digest, `source.provider === 'companion'`,
and per-origin allow/deny reusing the existing `resource` policy dimension. The
reason a side channel exists at all is that an application can hide state from the
operating system's accessibility layer — a browser's omnibox value, and an
editor's workspace identity.

Phase 2.3 measured the cost of not having the editor's answer: an episode whose
workspace the Host cannot vouch for is *unanchored*. It is shown honestly (the
applications it saw, rather than a shrug), but it cannot join a Work Thread and
cannot be grouped by where the work happened.

## Decision

**One intake, two source kinds.** The listener, the token, the rate limit, the
size limit and the Host-header check are unchanged from ADR 0007. A payload
declares `source: 'browser' | 'editor'`, and the two shapes are disjoint:

| | browser | editor |
|---|---|---|
| required | `origin`, `path`, `incognito`, `browserSession` | `workspaceRoot` (absolute), `editorSession` |
| optional | `title` | `title`, `filePath`, `languageId`, `surfaceKind` |
| resource | `url` (composed host-side, no query/fragment) | `file` at `filePath` |
| workspace | none — a browser window is not a workspace | **the vouched root**, verbatim |

**Contents are unrepresentable.** The editor shape has no field for text,
selections, file contents, editor decorations or UI strings, and validation
refuses **unknown fields** rather than ignoring them. A payload that tries to
carry a document body is rejected at the boundary — this is a property of the
type and of the validator, not a promise about what the extension chooses to
send.

**A vouched root is checked for coherence.** When `filePath` is present it must
live under `workspaceRoot`; a file outside the root it claims would make the
anchoring claim self-contradictory, and it is refused.

**Per-workspace consent reuses the existing dimension.** The workspace root is a
`resource`, so allow/deny is the same glob rule the user already has — no new
consent concept, no second list to keep in step.

**A workspace the editor vouched for is a distinct provenance.** The stored
`workspace_source` gains `'companion'`: it is neither an inference from a
document path (`filesystem`) nor the Host's own workspace (`dsh`), and recording
it as either would misstate how the Host knows. Widening the vocabulary costs one
migration for a CHECK constraint; misstating provenance costs the audit.

## Consequences

- Episodes recorded with the companion in play are anchored, get real
  `threadKey`s, and stop appearing as unanchored — the Phase 2.3 finding is fixed
  at its root rather than described better.
- The same fail-closed posture as ADR 0007 applies: unpaired, denied workspace, or
  a payload that does not validate stores nothing at all.
- The vocabulary change means a frozen-v1 database upgrades through a rebuild of
  `observations`; the migration runner's `rebuildsReferencedTable` path and its
  `foreign_key_check` cover that, and the upgrade test exercises it.
- Screenshots remain forbidden (ADR 0002). The editor companion is not a step
  toward the vision approach; it is the opposite one — ask the application that
  already knows.
