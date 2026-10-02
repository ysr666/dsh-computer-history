# Audit: what this Host knows, and what it would not keep

The two questions a person asks about a store like this one are "what do you
have?" and "what did you decide not to keep?". Phase 2.3 answers both from the
same predicates that decide what is stored, so an answer cannot drift from the
behaviour it describes.

## Export and import

```text
GET  /api/computer-history/export      → one JSON document
POST /api/computer-history/import      → reads one back
```

The document is a **projection of the tables that already exist** — resources,
policy state and rules, semantic opt-ins, observations, episodes, their
observations, resources, surfaces and summary citations — not a second schema.
An export therefore cannot disagree with the store it came from, and the import
reads it through a whitelist taken from the live database (`PRAGMA table_info`):
an unknown schema, an unknown table, an unknown column or a non-primitive value
is refused with a reason instead of half-importing. Importing the same document
twice is idempotent.

Two tables are deliberately absent, and `src/host/audit/export.ts` says why next
to them:

- `companion_pairing` holds the pairing token **digest**. It is a credential, not
  history;
- `deletion_log` records *that* something was deleted and which bundle id it
  belonged to — the "what used to exist here" a reader should not receive from an
  export.

A round trip is asserted by test, not described: counts, the episode's summary
text and kind, and its citation row all come back, and the serialised export is
checked to contain neither the digest nor the table name.

## Redaction preview

```text
GET /api/computer-history/audit/preview?scope=app:<bundleId>
GET /api/computer-history/audit/preview?scope=workspace:<id>
```

"What would this policy not keep?" — answered by **running the ingestion
predicates over stored rows**: `PROTECTED_BUNDLES`, `policyAllows`,
`isProtectedText`, the secure-path screen and `isUnlocatableFileName` are
imported from the normaliser for exactly this. Each excluded row carries a
reason, and the response names the rules in force (protected bundle ids and
protected patterns).

If the preview and ingestion ever disagree, one of them is a bug; sharing the
functions is what makes that visible. Writing the preview exposed one such
disagreement immediately: the first version omitted the secure-path screen, so a
`.env` resource looked safe in the audit while ingestion drops it.

## Observed versus declared

Two things in this store can look alike and are not: an application the
**operating system observed** (an Accessibility observation) and an application a
**companion declared** it was (ADR 0011). The difference is recorded, not implied:

| | where it shows |
|---|---|
| `observations.source_provider` | `'macos-ax'` for what the system saw, `'companion'` for what a paired companion claimed |
| the audit export | every observation row carries `source_provider`, so a reader can tell them apart without trusting the panel |
| the allow-list | applies identically to both: a declared identity the user has not allowed stores nothing |

A claim is validated before it is stored (an application-id-shaped bundle id, a
non-empty name, no extra fields) and it cannot unlock anything: an application the
built-in protected list covers is dropped whether the user allowed it or not.

## Timeline and provenance

```text
GET /api/computer-history/timeline?days=
GET /api/computer-history/episode?id=
```

`timeline` groups stored episodes into local days, newest first.
`describeProvenance` (in `src/shared/audit-view.ts`) turns the Host's boundary
vocabulary into a sentence:

```text
Recorded because a supported application became active; and it ended because the
machine went idle; 2 observations cited; 1 resource; 1 application; policy
revision 4; confidence 0.80.
```

An episode with no readable resource says so and names the applications it did
see, rather than showing an empty list.

## Retention

```text
GET  /api/computer-history/retention
POST /api/computer-history/retention   {observationRetentionHours, episodeRetentionDays}
```

Stored in `retention_settings` (migration 0005), not in a configuration file a
later default could quietly flip. Bounds are 1–720 hours and 1–365 days; anything
else is refused with a reason.

**The semantics matter more than the control.** The sweep deletes by the
`expires_at_ms` stamped when an observation was inserted, so the setting decides
the TTL of what is recorded *from now on*. Shortening the window does not reach
back and delete history the user did not ask to delete, and the panel states that
next to the inputs — a retention control that silently deleted stored rows would
be a deletion nobody requested.

## Controls in the panel

- per-application **Allow** and **Forget**, one click from an episode, so nobody
  has to type a bundle id. `Forget` removes the application's rules and then asks
  for its history to be deleted;
- per-site **Allow** / **Deny** for companion origins (ADR 0007);
- **Save retention**, with the window in force shown above it.

## A known gap in the tests

**Closed in 2.4.** The route-set guard compared a sorted list of paths against a
stub registry that silently overwrote a duplicate, so when `/retention` was
registered twice — once for GET, once for POST — it stayed green while the real
registry threw during setup and took the plugin's fiber down. The stub now
enforces the rule the real registry enforces, with the same message, and the
guard was calibrated both ways: a deliberate duplicate fails all seven tests, and
removing it passes. See `docs/validation-phase2-4.md`.
