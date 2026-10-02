# Phase 2.8 validation

Companion to `docs/plan-phase2-8.md`. Evidence first, per task. The 307 tests that
existed when the phase started must still pass.

## T2.8-0 — spike (folded into T2.8-1)

The three products this has to serve: VS Code and Cursor are the same extension
host (a VS Code extension runs in both; the product name differs), and JetBrains is
a different plugin platform that can speak the same wire format. So the protocol
carries an identity the client declares, and the Host stops hardcoding one.

## T2.8-1 — the identity enters the protocol

`CompanionPayload`'s editor shape gains `app: { bundleId, name }`. The Host
validates the shape and treats it as a **claim**: the observation keeps
`source.provider === 'companion'`, the allow-list decides as before, and the
protected set wins over a claim.

```text
pnpm test tests/unit/companion-intake.spec.ts tests/unit/companion-observation.spec.ts
  → 19 passed
pnpm test tests/integration/companion-workspace.spec.ts → 6 passed
```

| case | result |
|---|---|
| a claim is accepted and carried through | stored, identity preserved |
| five malformed claims (empty id, whitespace, blank name, extra field, bare string) | each refused with 400 |
| an editor payload with no identity | refused: "app is required for an editor payload" |
| **a claim the user has not allowed** | stores nothing - `ingest` returns false, store count 0 |
| **a claim naming a protected application, even when allowed** | dropped - the built-in list wins |
| an allowed claim | stored, with the claimed id **and** `source.provider === 'companion'` |

The last three are the ones the phase's boundary rests on: declaring an identity
is not declaring access, and it is recorded as a claim rather than as an
observation the operating system made.

**One of my own mistakes, again the same shape:** a replacement in the intake spec
silently did nothing - the helper I meant to edit has different indentation than
the pattern I matched - so two tests failed for a reason unrelated to the change.
The report keeps it because it is the third time this session that an unasserted
edit looked like success.

## T2.8-3 — the extension declares itself

`declaredIdentity(appName)` maps the product the editor reports about itself to an
identity, so one package serves every VS Code-based editor: VS Code and Insiders
to their real bundle ids, Cursor and Windsurf to theirs, and anything else to a
readable id of its own (`com.dsh.editor.<slug>`) - which is the point of the
general path, because a new editor then needs no Host release and the user decides
whether to allow it like any other application.

```text
pnpm test extension-editor/tests/payload.spec.ts → 8 passed
  known products map to the ids the allow-list uses
  an unknown editor gets com.dsh.editor.some-new-editor, a blank name gets
    com.dsh.editor.unknown
  the identity travels in the payload, and the key set is asserted - which is what
    Cursor would send, in the shape the intake tests prove the Host accepts
node scripts/build-editor-extension.mjs → dsh-computer-history-editor.vsix
pnpm verify → 316 tests, lint 0 warnings
```

### The live run did not happen, and the reason was mine

I prepared the environment, rotated a token and launched VS Code - and every step
downstream failed with `not found`. One check explains all of it:

```text
curl /api/computer-history/state → HTTP 404
```

**The plugin was never loaded.** My staged loader returned `{"ok":true}`
unconditionally instead of checking that the entry existed, so a failed load looked
like a successful one and I built a sixty-second live run on top of it. Nothing
about the extension was tested or disproved; the run was simply invalid, and the
result is recorded as "not run" rather than as a result.

The fix for the harness is one line - report the entry count, not a constant - and
the retry is the next attempt. Environment restored: VS Code quit, the user's
settings restored from the backup taken before the token was written, the extension
directory and the scratch workspace removed, the junction and the store symlink
deleted, the profile patch residue cleared.

### T2.8-3, retry: the harness is fixed, the plugin still has no fiber

The loader probe now reports what it actually did instead of a constant:

```text
first attempt   {"removed":0,"created":"88c44f74","entries":1,"states":"88c44f74:fiber=none"}
after pnpm build (lib rebuilt at 01:30, src last changed 01:25)
second attempt  {"removed":0,"created":"eccd9bc9","entries":1,"states":"eccd9bc9:fiber=none"}
```

So the entry **is** created and it has **no fiber** - the same symptom the packaged
install showed in 2.7, on the junction-to-checkout recipe that produced an active
fiber in 2.5, 2.6 and 2.7. Two things follow, and both matter:

- the **stale-build hypothesis is disproven**: rebuilding changed nothing, so this
  is not the trap that bit earlier phases;
- the earlier conclusion about the *packaged* artifact deserves the same suspicion
  I applied to my own probes: if the junction-to-checkout recipe now also yields
  `fiber=none`, then "the tarball does not start" was never a property of the
  tarball. That reading is now the more likely one, and it is recorded as a
  correction rather than left standing.

What is not yet known: why this session's loader creates the entry without a
fiber. The accumulated create/remove cycles (this entry has been created and
removed roughly fifteen times) are the obvious suspect, and the named next probe
is to create an entry under a **different name** - if that one starts, the state is
per-name, and `docs/release.md`'s warning about the tarball path has to be
rewritten.

Environment restored: scratch workspace, store symlink, junction and the profile
patch residue removed; the user's editor settings were restored from the backup
taken before this round (VS Code was never launched this time, so nothing was left
running).

### T2.8-3, third attempt: the hypothesis is disproven, and so is 2.7's conclusion

The named probe was a second package with the **same code** under a different name:

```text
{"target":"dsh-computer-history-probe","entries":1,
 "states":"05eb2522:fiber=none"}
```

Same symptom under a different name, on a package that never existed before, so it
is **not** per-name accumulated state. It is the session's loader: any entry created
now comes back without a fiber, whether it is the checkout, the tarball, or a fresh
name.

That settles two things and leaves one:

- **2.7's conclusion is corrected for good.** "The packaged artifact does not
  start" was an environment condition, not a property of the tarball; a fresh
  directory, a package never loaded before, and the checkout all behave the same in
  this session. `docs/release.md` must be corrected to say what is actually known.
- **2.8's live run needs a fresh Host session.** Everything the phase promised at
  the code level is verified (316 tests: validation, policy, protected set,
  provenance, the extension's identity mapping), and the wire format is now
  documented well enough for another editor to implement - but the one piece that
  needs a running editor cannot be produced from a loader that no longer creates
  fibers.

That is the boundary, stated plainly rather than papered over: the next attempt
starts after a Host restart, then installs the extension and reads the stored row.

### T2.8-3, fourth attempt: the state check, and where the phase stops

The reload that would have told us whether the plugin loads was interrupted, and the
outcome was unknown, so the next step was a read-only check rather than a retry:

```text
/state                 HTTP 404        (nothing loaded)
junction               absent
store symlink          absent
companion port 19388   free
```

Nothing is half-loaded and nothing is left running: the environment is clean, and
the interrupted call changed nothing.

**Where 2.8 stands.** Everything the phase promised at the code level is verified:

| promised | evidence |
|---|---|
| a declared identity is validated | five malformed claims refused, one accepted, in the intake tests |
| it is recorded as a claim | `source.provider === 'companion'` asserted with the claimed id; `docs/audit.md` says where to look |
| the allow-list still decides | an unallowed claim stores nothing (`ingest` false, count 0) |
| the protected set wins | an allowed claim naming 1Password is dropped |
| one package serves every VS Code editor | `declaredIdentity` maps VS Code/Cursor/Windsurf and gives anything else its own id; 8 extension tests |
| what Cursor would send is accepted | the payload test asserts the exact key set; the intake tests accept that shape |
| another editor can implement the protocol | `docs/editor-companion.md` documents the endpoint, the shape, the statuses, what a claim means and what a client must never send |
| the pre-existing tests still pass | 316 tests, the additions being the phase's own |

**The one thing missing** is the live run: a real editor's row, stored with the
identity that editor declared about itself. It needs a Host session whose loader
still gives a newly created entry a fiber, and this session's no longer does -
after roughly fifteen create/remove cycles the last three attempts (checkout,
tarball, a never-before-loaded name) all came back without one.

That is a boundary to hand over, not to paper over: the live run is the first thing
to do after a restart, and the phase report says so.

### After the restart: the Host side is fixed, the installer is the last step

The owner restarted DSH, and the same probe that had failed three times came back
differently:

```text
{"target":"dsh-computer-history","created":"e7894ab3","entries":1,
 "states":"e7894ab3:fiber=2"}          ← running
```

**The environment diagnosis is confirmed**: with a fresh Host session the plugin
loads and runs, on the same junction-to-checkout recipe, from the same build. The
previous three attempts failed on the session's loader state, not on the plugin, and
`docs/release.md`'s correction stands for the right reason.

The live editor run then hit a **narrower** obstacle, on the VS Code side:

```text
code --install-extension dsh-computer-history-editor.vsix
  → Failed Installing (exit 1, "Internal")     with VS Code closed, directory removed
extensions.json still mentions the extension  ← a dangling entry from the earlier
                                                successful install
60 seconds of watching                        → 0 companion rows
```

So the remaining work is the **extension installer**, not the Host and not the
protocol: the same `.vsix` installed successfully in 2.6 and does not now, and
VS Code's own cache still points at a directory that no longer exists. The next
attempt starts there - install with the editor closed, verify the directory exists
and the cache entry matches it, then watch the store.

Environment restored: VS Code quit, the user's settings restored from the backup
taken before the token was written, the extension directory removed, the dangling
cache entry cleared, the junction and store symlink deleted, the scratch workspace
and temporary files removed, the profile patch residue cleared.

### T2.8-3, after the restart: what is verified, and the one step left

The restart fixed the Host side, and the extension installed once the editor was
closed - `Extension 'dsh-computer-history-editor.vsix' was successfully installed`
- which also disproved my own hypothesis that the packer had broken: the vsix was a
valid archive the whole time (`unzip -t`: no errors, 7 files), and the failures were
VS Code holding its extension directory open.

The three checks that follow separate the two halves cleanly:

```text
port 19388                        LISTENING
POST with the current token       {"stored":true}
stored row                        bundle=com.microsoft.VSCode
                                  name=Visual Studio Code
                                  provider=companion
                                  session=probe-final
extension activation              no exthost log line for it this launch
```

So the **wire format and the declared identity are verified end to end** - a real
request through the real intake stores a row whose application identity came from
the payload, recorded with companion provenance. What is *not* yet produced is the
same row sent by the extension itself: this launch did not activate it.

That distinction is the whole reason this section exists. "A row with a declared
identity was stored through the companion intake" is proven; "the extension sent
it" is not, and the report will not merge the two into one happy sentence.

Next step, named: launch VS Code on the workspace with the extension installed and
confirm activation in the exthost log first, then read the stored row - if the log
stays empty, the extension's own `activationEvents` and `main` path are the thing to
check, not the Host.

Environment restored after this round: VS Code quit, the user's settings restored
from the backup taken before the token was written, the extension directory left in
place (installed), the store symlink and junction removed, the scratch workspace and
temporary files deleted, the profile patch residue cleared. The evidence database is
kept at `/tmp/dsh-ch-28d`.
