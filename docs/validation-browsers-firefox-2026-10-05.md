# The second browser engine, live — and the defect the live run found (T7.2), 2026-10-05

`docs/plan-three-platforms.md` T7.2: "the browser extension for another engine. No host change.", accepted by "a
live run stores a row with the same fields as the Chrome one", verified by "the live row".

Both live runs happened, in the same store, and their rows carry identical field sets. Getting there found a
defect that had been in the browser companion since it was committed.

## The defect: the payload had no `source`

The intake switches on `payload.source` (`if (source === 'editor') …; if (source !== 'browser') return 'source
must be "browser" or "editor"'`), and `buildPayload` in `extension/lib.js` never set it - `sendObservation`
POSTs the object verbatim. So **every observation the browser companion ever sent was answered
`400 source must be "browser" or "editor"`**, and the extension reports that only through
`console.debug('companion: intake answered', status)`, which nobody reads. The companion looked like it was
working and had never stored a row.

Found the honest way: the extension's own console, attached through CDP, said `debug: companion: intake answered
400` four times while its storage, its tab and its token were all correct.

The fix is one line in `buildPayload` (`source: 'browser'`), and the test that should have caught it is in
`tests/unit/companion-extension.spec.ts`: it asserts the **wire contract** - the exact field set and the source
the intake switches on - rather than mirroring whatever the implementation happens to return. It failed first on
the unfixed code, and the pre-existing test that compared the payload field by field had to be updated in the
same commit, which is exactly the shape of test that let this through.

The VS Code companion was checked for the same defect and does not have it (`extension-editor/src/payload.ts:62`
sends `source: 'editor'`).

## The two live rows

Same Host, same store, one row per engine:

```json
[{"id":"episode:browser-b7df45f5-5d14-459c-8d8b-fccfda246ebc:1",     // Firefox
  "surfaces":[{"bundleId":"companion.browser","surfaceKind":"browser","title":"Example Domain", …}]},
 {"id":"episode:browser-727c5395-b8a0-4bee-9b0e-5d57706e3403:1",     // Chrome
  "surfaces":[{"bundleId":"companion.browser","surfaceKind":"browser","title":"Example Domain", …}]}]
```

The session ids in the episode ids are the extensions' own (`browser-<uuid>`), and the field sets are identical:

```text
identical field sets across engines: True
surface keys: ['bundleId','firstSeenAtMs','lastSeenAtMs','observationCount','surfaceKind','title']
```

## How each engine was run

```bash
pnpm build:extension                       # Chrome  -> dist/extension
pnpm build:extension:firefox               # Firefox -> dist/extension-firefox

# Chrome: Chrome's debugging protocol can drive an extension's own context, so its storage was seeded through
# the extension's own API
npx web-ext run --target chromium --chromium-binary "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --source-dir dist/extension --args=--remote-debugging-port=9333
#   then, over CDP: Runtime.evaluate in the service worker ->
#   chrome.storage.local.set({ companionPort: 19488, companionToken: '<token>' })

# Firefox: Mozilla's own tool loads the unsigned build, and Firefox's remote agent exposes WebDriver BiDi
npx web-ext run --source-dir dist/extension-firefox \
  --firefox "/Applications/Firefox.app/Contents/MacOS/firefox" \
  --firefox-profile /tmp/ff-dsh --keep-profile-changes \
  --args=--remote-debugging-port --args=9222 --start-url https://example.com/from-firefox
```

## Four things that cost time, recorded so they cost it once

* **Firefox refuses to automate extension pages.** BiDi answers `unsupported operation: Navigation to
  "moz-extension://…" is not allowed in this context`, and its CDP serves no `/json` discovery. So the extension's
  options page - the only writer of its pairing token - cannot be automated, and pairing it is a user step. Chrome
  allows the same thing, which is why only the Firefox half needed a hand.
* **BiDi allows one session at a time** and keeps it until `session.end` or the browser closes; a script that just
  exits leaves the next connection with `Maximum number of active sessions`.
* **A long-running `web-ext` instance may not pick up a rebuilt extension.** The Firefox row appeared only after
  restarting `web-ext` against the fixed build - which also disproved my hypothesis that the stored port was the
  problem (it was 19488 all along).
* **A browser payload carries no resource.** `companionObservation` maps it to the fixed app id
  `companion.browser` and puts the URL in `window.url`, so the policy has to allow that **app**; allowing the
  origin instead answers `202 {"stored":false}` while the refusal counters stay empty.
