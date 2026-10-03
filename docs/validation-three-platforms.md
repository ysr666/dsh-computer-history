# Three platforms: what was verified, and what went wrong on the way

One section per phase. Mistakes stay in, because they are the part that is expensive to rediscover.

## P1 - the first minute works

### The preset, applied the way the panel applies it (integration tests)

`tests/integration/preset.spec.ts`, three tests against the real store, the real policy store and
the real ingestion service:

- on a store that has recorded nothing, an allowed editor is refused before the preset and stored
  after it;
- a protected application (1Password) is still refused after the preset, and the refusal is counted
  as `protected-app`;
- an application outside the preset is still refused, and nothing is stored.

### The first-run screen, on a clean store

```bash
npm install --prefix /tmp/dsh-cli-020 @deepseek-ai/dsh@0.2.0-rc.2   # the same version as the app
cp -R ~/.dsh/profiles/web ~/.dsh/profiles/firstrun                   # a profile of my own
dsh plugin --profile firstrun add ./dsh-computer-history-<version>.tgz
# add it to the profile's "bundles", then:
/tmp/dsh-cli-020/node_modules/.bin/dsh --profile firstrun --port 19420 --no-open
```

Evidence: `docs/assets/panel-firstrun-clean-store.png` - the sidebar entry **Computer History**, and a
panel whose first section is 从这里开始: what will be recorded, what never will be, the preset in the
interface's language, and one button (开始记录).

### Eleven rounds lost to a version mismatch, and how it hid

The panel registers `main` and `sidebar.panellist`. Those slots exist in **0.2.0-rc.2** (the app) and
not in **0.1.2-rc.1** (what `dsh` on `PATH` installs). A Host booted from the older CLI has no such
slot, so the registration silently does nothing - and every symptom pointed at the plugin: the client
bundle was in `window.__DSH_BOOT__.entries`, its request returned **200**, no exception was thrown,
and nothing rendered.

Two hypotheses were falsified on the way and are worth keeping: "the interface does not know about
the client half" (it does), and "the vision-router plugin is a valid control" (it registers different
slots, so it was not).

**The rule that would have saved the eleven rounds: check the Host's version against the interface's
before concluding anything about the plugin.**
