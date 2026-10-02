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

## T2.9-1 — the sentence that tells empty from broken

The panel now opens with one line that names what is actually going on, built by a
pure function in the shared layer rather than inside the view:

```text
level blocked  "Collection is paused, so nothing new is being recorded."
level blocked  "Collection is stopped, so nothing new is being recorded."
level blocked  "macOS has not granted Accessibility to the collector, so nothing can
                be recorded. Grant it in System Settings, Privacy & Security,
                Accessibility."
level blocked  "Nothing is allowed yet, so nothing will be recorded. Add an
                application below to start."
level idle     "Collecting, and ready. Nothing has been recorded yet."
level recording "Recording: 5 observations, newest 3 minute(s) ago."
```

It renders above every other section, in amber when it is blocking and green when it
is not. The ordering is the part that matters: **a state the user must act on
outranks a state that is merely quiet** - so "nothing is allowed yet" is said even
when the collection is running perfectly and has simply recorded nothing.

The data comes from endpoints the panel already fetched - `capture` and
`accessibilityTrusted` from `/state`, the allow-rule count from `/policy`, the
newest observation from `/recent` - so this needed no new backend field, which was
the design decision recorded in the previous round.

**The type told me my model was too narrow.** I had modelled `capture` as
`running | stopped | degraded`; the real state also has `paused` and
`permission-required`, and `permission-required` is the collector saying out loud
what a missing Accessibility grant means. Modelling both cases properly is three
lines and two test cases, and it is the difference between a sentence that is true
in five states and one that is true in three.

```text
pnpm test tests/unit/health.spec.ts → 4 passed
pnpm verify → 321 tests, lint 0 warnings
```

Still open in this task: the refusal counter is not on the panel yet (it needs the
wiring discussed last round), and the sentence has not been looked at in a real
window - a screenshot is the honest next evidence, and reading source is not.

## T2.9-2 — pairing, from "here is a token" to "here is what to do with it"

Reading the panel first changed the size of this task. The pairing UI already
existed and was already honest: a button that creates or rotates the token, the token
shown once in a selectable block, and the sentence that only a digest is stored so it
cannot be shown again. What was missing was **the step after that** - a new user held
a token and had nowhere to put it without reading the repository.

Added, in the panel, under the token:

1. a **copy** button (the clipboard is the only sane way to move a 43-character
   token; the text stays selectable for anyone who prefers that);
2. **the three steps**: browser extension → its options page; VS Code or Cursor →
   Settings, search "computer history", set the token and the port shown right there
   in the sentence; then reload the client;
3. **where to look when nothing arrives**: the editor extension writes its decisions
   to `~/.dsh/computer-history-editor.log`, which is the file that turned the last
   phase's silent failure into a sentence.

```text
pnpm typecheck → clean
pnpm verify → 321 tests, lint 0 warnings
```

**Still open, and named rather than implied:** the panel cannot yet say "a token
exists, but no client has ever connected". That is a backend fact -
`companion.lastSeenAtMs`, set when a request passes the token check - and it is the
next change. Without it, a user who mistyped the token still sees "paired" and
nothing else, which is the same class of ambiguity this phase exists to remove.

**Also still open:** neither this section nor the health sentence has been looked at
in a real window yet. Reading source is not evidence; the screenshot is, and it is
the next piece of work.

## T2.9-1 / T2.9-2 — the visual check, attempted and not obtained

Reading source is not evidence, so the panel was to be photographed. What happened:

```text
browser bridge      no extension connected - the GUI cannot be driven from here
screencapture       taken; the screen shows the DSH window with the sidebar listing
                    "Computer History", and the main area showing a *different*
                    session (a wallpaper-plugin cleanup)
panel itself        not open, so the screenshot is not evidence about it
```

Honest reading: the screenshot proves the plugin's sidebar entry exists and that the
panel was closed. It proves **nothing** about the health sentence or the pairing steps,
and it is recorded as an attempt rather than as evidence.

The two ways to get the real thing, either of which unblocks it:

1. open the panel (sidebar → Computer History) and take the screenshot; or
2. connect the browser bridge so the panel can be opened and captured from here.

Until then, the health sentence and the pairing steps are verified by tests and by
reading, which is weaker evidence, and the phase report says so rather than counting
them as done.

### Also still open: "a token exists, but nothing has ever arrived"

Named last round and not yet implemented: `companion.lastSeenAtMs`, set when a request
passes the token check, so a mistyped token stops reading as "paired" and nothing else.
It is the last fact the panel needs to answer "is it working?" completely.

## T2.9-2 — "paired" and "never used" are now tellable apart

The intake records the moment a request proves it holds a valid token, and only that
moment:

```text
pnpm test tests/unit/companion-intake.spec.ts → 21 passed
  lastSeen() is undefined before any request
  after a request with a valid token it is a number
  a request with the wrong token leaves it undefined
```

That closes the ambiguity a mistyped token used to create: the panel could only say
"paired", which was true of a client that had never once connected.

**A mistake worth recording, because it is the second of its kind today.** My patch
anchor was `export class CompanionIntake`, which is also the prefix of
`CompanionIntakeError` - so the first replacement hit the error class and left the
file as `Error extends Error {}` with two class declarations. `pnpm typecheck` named
the line immediately, the damage was one line, and the repair was to restore the name
and insert the fields into the class that actually has the server. **An anchor that is
a prefix of something else is not an anchor**; the third time this session an
unanchored replacement looked like success.

Still open in this task: wiring `lastSeen()` through the plugin's companion state into
`/state`, and the panel sentence that uses it. The fact is collected and tested; it is
not yet visible.
