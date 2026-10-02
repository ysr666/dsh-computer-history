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
