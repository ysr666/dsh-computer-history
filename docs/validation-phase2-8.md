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
