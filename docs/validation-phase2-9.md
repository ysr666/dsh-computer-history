# Phase 2.9 validation

Companion to `docs/plan-phase2-9.md`. Evidence first, per task.

## T2.9-0 — the walkthrough, and the assumption it corrected

Clean store, nothing configured, plugin loaded and running. What the product says,
verbatim:

```json
GET /state
{"enabled":true,"capture":"running","accessibilityTrusted":true,
 "collector":{"version":"0.1.0","arch":"arm64"},
 "companion":{"listening":true,"port":19388,"paired":false},
 "observationRetentionHours":24,"episodeRetentionDays":30,"autoResume":false}

GET /pairing    {"paired":false,"listening":true,"port":19388}
GET /recent     []
GET /timeline   []
GET /semantic   {"active":"deterministic","localProviderConfigured":false,"scopes":[]}
GET /policy     include-only, plus built-in protect rules (1Password, Bitwarden, …)
```

**One of the plan's assumptions was wrong, and the walkthrough is why it exists.**
I expected Accessibility permission to be invisible. It is not: `accessibilityTrusted`
is reported, and `capture: "running"` is reported with it. The state endpoint already
answers the question I thought nobody could answer.

### The real gap, and it is bigger

The default policy is `include-only` with **only protect rules**. There is no allow
rule on a fresh store, so **nothing is collected at all** - and the product does not
say so anywhere:

- `/recent` and `/timeline` return `[]`, identical to "nothing happened yet";
- `/policy` returns the rules, which a user must interpret to work out that the
  consequence is "you will never see anything";
- nothing counts the observations the policy **refused**, so the strongest possible
  evidence that collection is working and the policy is not - a refusal count - is
  not reported at all.

An empty timeline on a fresh install therefore has four indistinguishable meanings,
and the product reports none of them: nothing happened, collection is broken, the
policy allows nothing, or the collector is not running. Only the last is answered.

### The ordered backlog this produces

1. **Say that nothing is allowed, and offer the fix.** `include-only` with zero allow
   rules is the state every new user starts in; it must be named in `/state` and in
   the panel, with the allow flow one step away.
2. **Report the facts that separate empty from broken**: newest observation's age,
   how many observations the policy refused, how many the collector produced, and
   since when collection has been running.
3. **Pairing as a flow, not a fact.** `/pairing` reports `paired: false` and stops.
   Getting a client working means minting a token and copying it into that client's
   own settings by hand - the step that has cost this project three debugging rounds
   already. The panel should mint, show once, copy, and revoke per client.
4. Corrected, not a gap: Accessibility permission is already reported; it needs to be
   *shown* in the panel next to the other facts, not discovered through the API.

Items 1 and 2 are the same change - the panel and `/state` gaining the facts that
answer "is it working?" - and they are T2.9-1. Item 3 is T2.9-2.

### Environment

Clean store at `/tmp/dsh-ch-29-fresh`, plugin loaded and running (`fiber=2`), junction
and store symlink in place for the next round. Nothing else was started.

## T2.9-1 — the number that separates "nothing happened" from "nothing is allowed"

The first fact is in: how many messages the policy turned away since this Host
started. It is counted in one place - around `ingestNow`, so every refusal path is
covered without touching seven `return false` sites - and exposed as
`IngestionService.refusedSinceStart()`.

```text
pnpm test tests/integration/companion-workspace.spec.ts → 7 passed

  refusedSinceStart() is 0 on a fresh Host
  a message the policy refuses → 1, and the store stays empty
  an allowed message → stored, and the counter does not move
```

The test goes through the real path (a companion claim the user has not allowed),
not a stub, so it measures the same thing a fresh install would experience.

Still to do for this task, and the reason it is not finished: the number is not yet
reported by `/state` and therefore not visible in the panel, and the "nothing is
allowed" state - `include-only` with zero allow rules - is still something the user
has to infer from the policy rules. The remaining work is the state payload and the
panel sentence, both of which are small.

### T2.9-1 — where the facts have to be assembled, decided before writing them

Reading the wiring changed the plan for the better. `getState()` lives on the plugin
class, which holds only the collector manager, `enabled`, `ownsCapture` and
`companion()` - it has **no access to the policy, the stores or the ingestion
service**. So "health" cannot simply be added there without handing the plugin three
more dependencies it otherwise does not need.

What the panel needs is already reachable, split across two endpoints it already
calls:

| fact | where it comes from |
|---|---|
| collection running, and why not | `/state`: `capture`, `reason` |
| Accessibility granted | `/state`: `accessibilityTrusted` |
| collector version and arch | `/state`: `collector` |
| companion listening / paired | `/state`: `companion`, `/pairing` |
| **nothing is allowed, so nothing will be recorded** | `/policy`: zero rules with `action: "allow"` |
| newest observation and its age | `/recent` / `/timeline` |
| messages the policy refused | **not yet exposed** - the counter exists in the ingestion service, and surfacing it needs the service wired to whoever composes `/state` |

So the sentence a new user needs - "collection is running, macOS permission is
granted, **nothing is allowed yet, so nothing will be recorded**" - needs **no new
backend field**: the panel can derive it from what it already fetches. That is the
next change, and it is a client change only.

The refusal counter is worth exposing, but it belongs with the wiring work: the
honest place is wherever `/state` is composed with access to the stores, not smuggled
into a plugin that has none.
