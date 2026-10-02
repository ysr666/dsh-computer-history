# ADR 0008: A file name the Host cannot locate is not stored

Status: Accepted
Date: 2026-10-02
Accepted by: project owner (continued Phase 2.3 with F13 to be closed)

## Context

Phase 1 finding F13: when a window is matched by the user's protect rules and
`kAXDocument` is not readable at that moment, the collector still stored an
observation carrying only the window title. The protect rule matches a *path
glob*, and a bare file name is not a path; the sensitive-marker heuristic
(`.env`, `.ssh/`, `.pem`, `.key`, `credentials`, `secrets`) never looked at
titles. Measured example: `notes.txt res='-'`.

The exposure is small — no resource means no episode, so `recent` and `search`
never show it, and the row expires with the 24-hour observation TTL — but the
file name of a document the user believed was protected sat in the raw table.

## Decision

When the policy contains **any** protect rule (`dimension: 'resource'`,
`action !== 'allow'`) and a window offers **only a bare file name** as its title
— no whitespace, no directory separator, a short extension — with no readable
resource, the observation is dropped.

The reasoning is placement, not content: the Host has been told that some paths
are protected, it cannot see where this file lives, and it therefore cannot
promise the name is safe to store. Refusing to guess is cheaper than being wrong.

This can only ever *drop* an observation. Nothing becomes storable that was not
storable before.

## Consequences

- A file name is lost for users who have protect rules and whose editor exposes
  no document at that moment. That is the intended trade: a slightly thinner
  history in exchange for not storing a name the Host cannot place.
- The rule is narrow on purpose: a window titled `notes.txt — Editor` or
  `Doing the thing` is unaffected, and so is any window with a readable document
  (which the policy screens by path, as before).
- The decision is reversible in one place (`isUnlocatableFileName`) if a future
  owner prefers the residue over the loss.
