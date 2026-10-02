# Browser companion

The companion is a Chrome MV3 extension that reports **which page you are on** —
origin, path and the tab title — to the local DeepSeek Harness Computer History
intake. It is the only source allowed to store a URL (ADR 0007); a browser
window seen through Accessibility still contributes nothing.

## What it collects, and what it never touches

| Collected | Never touched |
|---|---|
| origin and path of the active tab | page content, DOM, selection, form values |
| tab title | private (incognito) windows — the extension is not allowed there |
| when it changed (activation, navigation) | any site you deny in the policy |

The query string and the fragment are removed **twice**: by the extension before
it sends, and by the Host before it stores. A URL like
`https://example.test/docs/guide?token=secret#part-3` is stored as
`https://example.test/docs/guide`.

## Install

1. `pnpm build:extension` → packages the extension into `dist/extension/`.
2. In Chrome: `chrome://extensions` → enable *Developer mode* → *Load unpacked*
   → choose `dist/extension/`.
3. The extension asks for `tabs` and `storage`, and for host access to
   `127.0.0.1` only. Anything else is a mis-build: `pnpm build:extension`
   refuses a manifest that widens either.

Chrome 154 ignores the `--load-extension` command line, so automation loads it
over CDP instead (`Extensions.loadUnpacked`, with
`--enable-unsafe-extension-debugging`); a person installing it by hand uses the
steps above.

## Pair

1. In the Computer History panel, rotate the pairing token. **It is shown once**:
   only a SHA-256 digest is stored, so it cannot be read back later.
2. Open the extension's options page and paste the token, then *Save*. *Test
   pairing* asks `GET /companion/health` on the intake and reports whether the
   port and the token agree.
3. The intake listens on `127.0.0.1:19388` by default (configurable through the
   plugin's `companionPort`). It is bound to loopback only; the panel shows
   "companion unavailable" with the reason if the port is taken.

Rotating the token invalidates the old one immediately: the extension's next
report is answered `401` and stores nothing.

## The privacy matrix

Run on real Chrome, one cell per promise (full recipe in
`docs/verification-guide.md`):

```bash
node scripts/verify/chrome-companion.mjs --token <token> \
  --db <data directory>/history.sqlite --cookie /tmp/dsh-ch-cookie.txt \
  --extension dist/extension
```

Measured 2026-10-02 (Chrome 154.0.8037.95):

| Cell | Result |
|---|---|
| allowed origin | 0 → 1 companion row; resource `http://127.0.0.1:<port>/allowed/page` |
| query string and fragment | never stored |
| denied origin | no new rows |
| incognito window | no new rows |
| rotated token | no new rows |
| extension not loaded | no new rows |

The script fails the whole matrix if the control cell fails, because "no rows"
only means something when the same setup can produce a row.

## Pause, disable, uninstall

- **Pause** in the panel stops the companion too: the intake answers
  `202 {stored:false}` and records nothing, exactly as the Accessibility
  collector stops.
- **Disable** the extension in `chrome://extensions` to stop all browser
  reporting; the intake stays up for a future pairing.
- **Uninstall**: remove the extension, then rotate the token in the panel — the
  old token is invalid from that moment. The pairing row lives in the history
  database and disappears with it.
