# Panel review, first time anybody looked at it

Evidence: `docs/assets/panel-2026-10-03-before.png`, captured through my own headless
Chrome with the auth cookie - not a screenshot the owner had to take.

The panel text, as rendered:

```text
Capture: running · Accessibility: granted · Raw retention: 24h
Browser companion   Listening on 127.0.0.1:19388 · token created, but no client has ever used it
                    [Rotate pairing token]  [https://example.com] [Allow site] [Deny site]
Retention           Raw observations are kept for 24 hours and episodes for 30 days. A change
                    applies to what is recorded from now on; it does not delete history you
                    already have.   Observation hours [24] Episode days [30] [Save retention]
Timeline            Nothing recorded in the last seven days.
Summaries           Deterministic summaries are on (nothing leaves this machine). Local model:
                    not configured; remote: never without a scope opting in.
                    No scope uses a model, so every summary here was computed locally.
                    ▓▓▓▓▓▓▓ (an empty amber bar - see below)
Resume              [e.g. continue the billing work] [Find where I left off]
Work threads        No threaded work yet: episodes need a workspace the Host can vouch for.
                    [Pause capture] [Delete all history] [Refresh]
Privacy & app access Capture is include-only. Phase 1 accepts only supported metadata adapters
                    (VS Code/Cursor, Terminal/iTerm, Preview, Finder); browsers and unknown apps
                    fail closed before storage.   [com.example.App] [Allow app] [Forget app]
Recent work episodes
```

## What is wrong, in the order a user meets it

1. **The health sentence is invisible.** It renders as an **empty amber bar**: the DOM
   contains "Nothing is allowed yet, so nothing will be recorded", but the element has no
   visible text. Cause: the inline style I wrote assumes a light theme (cream background
   `#fffbeb` with inherited light text). On this dark theme that is light-on-light. **My
   own bug, introduced by styling without looking.**
2. **It is not first.** The page opens with a technical line
   (`Capture: running · Accessibility: granted · Raw retention: 24h`) and the single fact
   that matters - *nothing is allowed, so nothing will be recorded* - sits twenty lines
   down, where it is also invisible.
3. **English only.** The host interface is Chinese; the panel is entirely English. A user
   who set the product to Chinese meets an English plugin.
4. **Engineering prose in a user interface.** "Phase 1 accepts only supported metadata
   adapters (VS Code/Cursor, Terminal/iTerm, Preview, Finder); browsers and unknown apps
   fail closed before storage" is a sentence from a design document, not from a product.
   Same for "Raw retention", "include-only" and "scope".
5. **No visual system.** Sections are bare headings; buttons are loose
   (`Pause capture`, `Delete all history`, `Refresh` sit ungrouped); inputs have no labels
   (`Observation hours` is a placeholder-less number box next to a word); colours are
   hardcoded in three places, which is what produced bug 1.

## The order of work this produces

1. **Theme-aware styling, no hardcoded colours** - delete the light-theme constants, use
   the host's tokens, and put the health line first.
2. **Chinese and English**, following the host's own language instead of inventing a
   plugin-level switch.
3. **Human copy**: say "还没有允许任何应用，所以什么都不会被记录" instead of
   "include-only", and drop the design-document sentences into `docs/`.
4. **A small visual system**: one spacing scale, one heading level, grouped actions,
   labelled inputs, and a real empty state per section.

Each step is verified the same way this review was: capture the panel, look at it, and
compare with the previous capture.

## Iteration 1, and what looking at it changed

Evidence: `docs/assets/panel-2026-10-03-after1.png` against the before image.

**Fixed:** the invisible health line. The DOM text was always there; the element was
light-on-light because I had hardcoded a cream background for a light theme. It is now
`border-left: 3px solid currentColor` with no colour of its own, so it is legible in
either theme - and the theme decides, not me.

**Fixed:** the language. The interface publishes `<html lang="zh-CN">`, so the panel
follows it and needs no setting of its own. The status line now reads
`采集：running · 辅助功能：已授权 · 保留：24 小时`, and the health sentence reads
`还没有允许任何应用，所以什么都不会被记录。在下面添加一个应用即可开始。`

**Not fixed, and now measured:** the health line is still **not first**. It renders
between "Summaries" and "Resume" - the section list I edited is not the one that
decides the visible order. The page still opens with a technical line, so the first
thing a user reads is `采集：running · 辅助功能：已授权 · 保留：24 小时` rather than
the one fact that requires an action.

**Still English, section by section:** Browser companion, Retention, Timeline,
Summaries, Resume, Work threads, Privacy & app access, and every button and prose
sentence in them. Also still prose from a design document ("Capture is include-only.
Phase 1 accepts only supported metadata adapters…").

The order of work for the next iteration therefore does not change: fix the ordering,
then translate what is left, then replace the engineering sentences with human ones,
then the visual system. Each step ends with a capture and a comparison, which is how
this iteration found both the bug and the thing it did not fix.
