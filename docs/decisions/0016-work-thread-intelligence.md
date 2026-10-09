# ADR 0016 — Work Thread Intelligence as evidence-linked suggestions

Status: Review candidate (M4)
Date: 2026-10-10

## Scope

M4 improves the ability to inspect cross-application and cross-time activity **without**
changing Work Thread identity, Resume/Episode selection, Continue, Work State targets,
captured event types, privacy defaults, or retention semantics.

## Authoritative vs advisory

An authoritative Work Thread still contains only Episodes with exactly the same
trusted `threadKey` from DSH/companion workspace identity or git root. M4 does
**not** alter `threadKey`, inferred membership, or persistent project notes.

M4 adds a read-only **sidecar** shown in the Work Memory project inspector:
- **Exact local file**: an otherwise unassigned Episode and the trusted project
  cite exactly the same canonical local file URI, including its full path.
  The URI must be unique to that trusted Work Thread among retained scanned
  evidence. This is evidence of a possible relationship, *not* proof of project
  membership.
- **Nearby, unattributed**: an otherwise unassigned Episode lies within ten
  minutes of a trusted project Episode, and no other trusted Work Thread has
  activity within that window. This remains explicitly `unattributed`,
  never `resource-linked`. If both sides cite different local files, the
  time-only suggestion is suppressed.

Window titles, shared resource basenames, app names and generic web domains
never establish project identity. Explicitly assigned Episodes from a
different trusted project are never imported or suggested for reassignment.
An exact file used by several trusted threads is considered ambiguous and
cannot become a unique resource link.

Each suggestion includes the source Episode ID, trusted anchor Episode ID,
observed time, application bundle IDs, evidence tier, and the exact shared
resource URI only when both sides cite it.

## Bounded query and lifecycle

The Host loads up to 250 recent retained Episodes belonging to the requested
project and up to 750 globally recent retained Episodes. It deduplicates
them by ID and projects at most 20 associations. The response has explicit
`scanTruncated` for bounded scans and `scannedEpisodes`.

The project identity is resolved via `listMemoryThreadKeys`; no fuzzy
matching or similarity-based merging is introduced. Short-lived Episodes and
raw observations continue to obey their respective retention policies.
There is no new database table, cache, model call, network egress, or
background collection. A Forget/delete operation is reflected on the
next query because suggestions are rederived entirely from retained Episodes.

No "not found" result may be interpreted as proof that no such work occurred,
especially when the bounded scan is incomplete.

## Entry points

- Host local GET `/api/computer-history/memory/links?id=pm_...`
- Typed service `getThreadActivityLinks(id)`
- Optional read-only Agent `computer_history_activity_links`
- Work Memory panel: "Cross-application activity hints" with separate
  exact-file and nearby-unattributed labels.

All Agent-visible text is untrusted metadata. None of these entry points
gives permission to open resources or treats observed tests as current truth.

## Tests and rollout boundary

Regression tests cover exact canonical matching, project collisions,
same-basename mistakes, URL/domain non-matching, multi-project simultaneous
activity, proximity windows, deleted/invalidated evidence, deterministic order,
pagination bounds, older projects outside global recency, Host routes, Agent
input validation and unchanged Work Thread identity.

No real-user acceptance or package release is implied by merging M4; those
remain separate release steps.
