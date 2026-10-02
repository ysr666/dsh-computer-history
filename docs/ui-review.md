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

## Iteration 2 - order, colour and the words a user actually reads

Evidence: `docs/assets/panel-2026-10-03-after2.png` (against `-after1` and `-before`).

What the panel now reads, top to bottom:

```text
电脑使用记录
这台电脑被用来做了什么，只保存在本机。
| 还没有允许任何应用，所以什么都不会被记录。在下面添加一个应用即可开始。
采集：running · 辅助功能：已授权 · 保留：24 小时
浏览器伴侣   [重新生成配对令牌] [https://example.com] [允许该网站] [拒绝该网站]
保留策略     … [保存]
时间线       …
摘要         …
从这里继续   [找到上次的位置]
工作线索     [暂停采集] [删除全部历史] [刷新]
隐私与应用权限 …
```

Three fixes, each one caused by looking rather than by reading:

1. **The order was wrong in a way I had misdiagnosed.** I had inserted the health
   section into the list that assembles the sections - but the visible order is decided
   by the children of `<main>`, which is a different list. That is why the previous
   iteration reported "fixed" while the screenshot still opened with a status line. The
   actionable sentence is now the first thing under the title.
2. **Every hardcoded colour is gone** (8 sites: `#555`, `#666`, `#f2f2f2`). They were the
   same mistake as the invisible bar - light-theme constants - and on the dark theme they
   rendered as the dim, hard-to-read grey visible in the earlier screenshots. Emphasis is
   now `opacity` and `currentColor`, which the theme owns.
3. **The strings a user reads first are bilingual**, following `<html lang>`: the title,
   the one-line explanation of what the product is, every section heading and the buttons.
   That includes a subtitle the panel never had - "这台电脑被用来做了什么，只保存在本机",
   which answers "what is this thing" before any control.

**Still English, and next:** the body prose inside the sections (the pairing line, the
retention explanation, the empty states, `Observation hours` / `Episode days`, the work
threads line, and the whole privacy paragraph, which is still design-document prose:
"Capture is include-only. Phase 1 accepts only supported metadata adapters…").

**Also still raw:** the status line prints `采集：running`, mixing a Chinese label with the
collector's internal state word.

After the prose and the raw state, what remains of this work is the visual system -
spacing scale, inputs with labels, actions grouped, one accent - which is worth doing
after the words, because the words are what makes it usable and the polish is what makes
it pleasant.

## Iteration 3 - the words, and the two anchors that taught me to verify before writing

Evidence: `docs/assets/panel-2026-10-03-after3.png`.

Now Chinese, following the interface: 采集：正在采集 · 辅助功能：已授权 · 保留：24 小时;
正在监听 127.0.0.1:19388 · 令牌已生成，但还没有任何客户端用过它; 最近七天还没有记录。
还没有成线索的工作：需要宿主能确认的工作区才会成线索。 Placeholders too
(例如：继续计费那件事, 例如 com.apple.Safari).

The privacy paragraph stopped being a design document:

```text
before  Capture is include-only. Phase 1 accepts only supported metadata adapters
        (VS Code/Cursor, Terminal/iTerm, Preview, Finder); browsers and unknown apps
        fail closed before storage.
after   只有你下面允许的应用会被记录，而且只记元数据：哪个应用、哪个文件、用了多久——
        绝不记录屏幕内容、文档内容或选中文字。
```

The collector's internal state word is gone from the interface as well: `running` is now
`正在采集` (with `paused`/`stopped`/`degraded`/`permission-required` translated too).

**Two of my edits silently did nothing, and the assertions are why I know.** One anchor
was written with the wrong indentation, another as a single-quoted string when the source
has a backtick template; both matched zero times, so the script aborted before writing
instead of half-applying. That is the fourth time this session a replacement looked like
success - and the first time the guards caught it *before* the file changed, which is the
whole reason to assert on the count instead of trusting `replace`.

**Still English, and next:** the retention explanation and its two labels
(`Raw observations are kept for 24 hours…`, `Observation hours`, `Episode days`) and the
first line of Summaries. After those, the visual system: spacing, inputs with labels,
grouped actions, and one accent for emphasis.
