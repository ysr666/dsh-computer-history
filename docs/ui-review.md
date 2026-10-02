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

## Iteration 4 - the interface is fully in the interface's language

Evidence: `docs/assets/panel-2026-10-03-after4.png`.

The panel now reads, top to bottom, with no English left in it when the interface is
Chinese:

```text
电脑使用记录
这台电脑被用来做了什么，只保存在本机。
| 还没有允许任何应用，所以什么都不会被记录。在下面添加一个应用即可开始。
采集：正在采集 · 辅助功能：已授权 · 保留：24 小时
浏览器伴侣   正在监听 127.0.0.1:19388 · 令牌已生成，但还没有任何客户端用过它
             [重新生成配对令牌] [例如 https://example.com] [允许该网站] [拒绝该网站]
保留策略     原始记录保留 24 小时，工作片段保留 30 天。修改只影响之后记录的内容，
             不会删除你已经有的历史。  [原始记录保留 24] [工作片段保留 30] [保存]
时间线       最近七天还没有记录。
摘要         摘要在这台电脑上计算，不会离开本机。本地模型：未配置；除非你为某个范围
             打开，否则绝不会使用远端模型。
从这里继续   [例如：继续计费那件事] [找到上次的位置]
工作线索     还没有成线索的工作：需要宿主能确认的工作区才会成线索。
             [暂停采集] [删除全部历史] [刷新]
隐私与应用权限 只有你下面允许的应用会被记录，而且只记元数据：哪个应用、哪个文件、
             用了多久——绝不记录屏幕内容、文档内容或选中文字。 [例如 com.apple.Safari]
最近的工作片段
```

Two things this iteration also fixed by accident of looking:

- the retention sentence said "Raw observations" and "episodes" - internal words for a
  user - and now says what is kept, for how long, and what a change does;
- the Summaries section said the same thing twice ("Deterministic summaries are on
  (nothing leaves this machine)" followed by "No scope uses a model…"), so the first
  line now carries the fact and the caveat together.

**What is left of this goal is the visual system, and the panel still looks like a
document, not a product**: sections are bare headings with no separation beyond
`marginBottom`, the two number inputs sit inline with their labels run together
(`原始记录保留 24`), buttons are loose with no grouping, there is no accent colour and no
hierarchy between a section title and its body. That is the next iteration, and the
first of them will be spacing and grouping, because the words are now correct and the
structure is what is left to make legible.

The headless Chrome is deliberately still running: the acceptance loop for the next
iteration is a capture, and it will be closed when this goal stops needing captures.

## Iteration 5 - one spacing scale, and the last five English strings

Evidence: `docs/assets/panel-2026-10-03-after5.png`.

The layout had the same numbers written inline in fourteen places
(`marginBottom: 20` seven times, `margin: '0 0 8px'` six, `opacity: 0.75, margin: '0 0 6px'`
two). They now come from one scale - `SPACE = { xs: 4, sm: 8, md: 12, lg: 18, xl: 26 }` -
and the two retention inputs sit in a `FIELD_LABEL` row instead of running into their
boxes: `原始记录保留 [24]  工作片段保留 [30]  [保存]`.

The pass also caught five strings the earlier sweeps missed, all of them invisible until
the panel was in front of me: `Capture disabled in plugin config`, `Resume capture`,
`Capture unavailable`, `Confirm delete all history`, `Cancel`.

**Two mistakes of mine, both caught before the file changed:**

- a replacement anchored on `{ style: { marginBottom: 20 } }` assumed one spelling; the
  source has four, so the count assertion fired and nothing was written -
- the first attempt declared `SECTION` and `H2` constants and then wrote the expressions
  inline, leaving two constants unused and the typecheck red. The honest fix was to delete
  the constants rather than change six call sites to justify them; the numbers still come
  from `SPACE`, which was the actual goal.

**Still a document, not yet a product**, and it is now specific: sections have no
separation beyond their margin, every button looks identical (nothing is primary and
nothing is marked destructive), `删除全部历史` sits in the same row as `刷新`, and the two
muted lines under 摘要 read as two separate facts. That is the next iteration.

## Iteration 6 - separators, and buttons that look like buttons

Evidence: `docs/assets/panel-2026-10-03-after6.png`.

The host exposes a real design system - 735 CSS variables, including
`--dsw-radius-sm: 8px`, `--dsw-radius-md: 12px`, `--dsw-radius-lg: 16px` and the code font
stack - so the panel now takes its radius from `var(--dsw-radius-sm, 8px)` instead of my own
number. Sections carry a hairline (`1px solid rgba(127,127,127,0.22)`, neutral so it works
on either theme) and a consistent rhythm, and every button has a base shape: inherited
font, padding, radius from the token, transparent background, `currentColor` border and a
pointer cursor. Before this they were bare `<button>` elements, which is why they looked
unrelated to each other and to the interface around them.

**One mistake, the same one as last iteration and caught the same way:** I declared
`BUTTON_PRIMARY` and did not use it, so the typecheck went red and I deleted it rather
than retrofitting call sites. Two iterations in a row the lesson is identical - declare
what the code reads, not what the design intends.

**What is left of the visual system, and it is now a short list:** nothing is marked
primary (保存 and 允许该应用 look exactly like 刷新), nothing is marked destructive
(删除全部历史 looks exactly like 暂停采集), and the four action buttons still sit in one
row with the delete beside the refresh. That regrouping is the next iteration - and it
needs the container's structure read first, not guessed.

## Iteration 7 - hierarchy: what is primary, and what is dangerous

Evidence: `docs/assets/panel-2026-10-03-after7.png`.

Three shapes now, all built from the base button and the host's tokens:

| shape | where | what it says |
|---|---|---|
| `BUTTON_PRIMARY` (bold, `currentColor` border) | 重新生成配对令牌, 允许该网站, 保存 | this is the action you probably came for |
| `BUTTON_DANGER` (bold, `var(--dsw-color-danger, currentColor)`) | 删除全部历史 | this one cannot be undone |
| `BUTTON` | 拒绝该网站, 暂停采集, 刷新, 取消, 忘记该应用 … | everything else |

The danger colour comes from the host with a fallback, so the panel still never invents a
colour - which is the rule that started all of this, after a hardcoded cream background
made the most important sentence on the page invisible.

**The same mistake for the third time, and the reason is worth writing down.** My
line-based pass gave 11 buttons the base shape, 1 the danger shape, and **zero** the primary
one, because the four buttons I had styled in the previous iteration were skipped by the
loop - so `BUTTON_PRIMARY` was declared and unused, and the typecheck went red again. The
fix was to upgrade the three named actions rather than delete the constant, because
hierarchy is the point of the iteration. The pattern across all three: I keep writing the
design intent and leaving the wiring for later, and the typecheck is what makes me finish.

**What is left:** section empty states (the timeline and work-threads sections have one;
最近的工作片段 renders nothing at all when there is nothing to show), and the four action
buttons still share one row - `删除全部历史` now looks dangerous but still sits beside
`刷新`, which is a grouping question rather than a styling one.

## Iteration 8 - the empty state for the one section that had none

Evidence: `docs/assets/panel-2026-10-03-after8.png`.

`最近的工作片段` rendered **nothing at all** when there were no episodes: a heading with
empty space under it, which is the exact state the plan calls "the user faces a blank and
does not know what to do". It now says:

```text
还没有工作片段。记录持续一会儿之后，这里会出现第一个片段。
```

which answers both halves - what this section is, and what would make something appear in
it.

**One change did not land, and it is recorded rather than quietly retried.** I tried to add
a warning under the destructive action ("删除全部历史不可撤销；它只删除这台电脑上的记录。")
by anchoring on the refresh button's tail; the anchor did not match the source, the
assertion fired, and nothing was written. The next attempt reads that block first - which is
the rule I keep relearning in this phase, and the reason two of these eight iterations have
"saved" a replacement that never happened.

**What is left of the goal's six criteria:** ①-⑤ are done and verified by looking (the
actionable sentence first, the interface's language, both languages at every level,
no design-document prose, and a visual system with one spacing scale, theme tokens,
button hierarchy and danger marking). ⑥ is done except for the grouping question - the
destructive action is *marked* but still sits in the same row as 暂停采集 and 刷新, and the
warning line that would separate it did not land.

## Iteration 9 - the destructive action has its own line

Evidence: `docs/assets/panel-2026-10-03-after9.png` (top) and
`docs/assets/panel-2026-10-03-after9-bottom.png` (scrolled to the end).

`删除全部历史` used to sit between `暂停采集` and `刷新` as if it were routine. It now lives
in its own block - `width: 100%` inside the same row so it breaks onto its own line, a
hairline above it, and the sentence that says what it does:

```text
删除全部历史不可撤销，它只删除这台电脑上的记录。
```

The change is small and the reason is a product one: an action that cannot be undone
should not look like the buttons beside it, and the user should not have to discover that
by pressing it.

**A note on how this iteration was verified, because the first capture was not enough.**
The panel is taller than the viewport, so the screenshot that verified the previous eight
iterations stopped at 工作线索 and the destructive row was below the fold - which would have
been "verified by looking" in name only. The capture was redone scrolled to the end, and the
rendered text of that region is printed with it. That is the same trap as the two silent
replacements: a check that reports success while not covering the thing it claims to.

### Correction: the "scrolled" capture is not scrolled

The bottom capture I stored is **the same view as the top one**, so it does not verify the
destructive row. `window.scrollTo(0, document.body.scrollHeight)` did nothing because the
panel scrolls inside a container, not the document - and I stored the image without
comparing it to the previous one, so a capture that proved nothing was briefly counted as
proof.

What that row has, honestly: the **rendered text** of the live page
(`暂停采集 | 删除全部历史 | | 删除全部历史不可撤销，它只删除这台电脑上的记录。 | | 刷新`)
and the source. What it does not have: a reviewed image.

The fix is one option, not a scroll: `Page.captureScreenshot` with
`captureBeyondViewport: true` and a clip over the full page height, which is what the next
iteration uses - and the image is compared against the previous one before it is stored,
which is the check I skipped.

## Iteration 10 - the fix that broke something, seen only by looking

Evidence: `docs/assets/panel-2026-10-03-after10-bottom.png`.

Giving the destructive action its own line worked, and **broke the row it was in**: with
`width: 100%` inside a flex row that did not wrap, `暂停采集` was squeezed into a two-line
column and `刷新` into two vertical characters. Nothing in the source looked wrong; the
panel did. The row now wraps (`flexWrap: 'wrap'`), which is what makes a full-width child
mean "own line" instead of "squeeze the others".

**The scroll problem was real, and the fix was to stop scrolling the wrong thing.**
`window.scrollTo` and `captureBeyondViewport` both produced the same viewport-sized image,
because the panel scrolls inside a container and the document has no extra height. The
capture now scrolls **every scrollable ancestor** of the row it wants to show and reports
the row's geometry before shooting:

```text
warning row: {"found":true,"scrolled":1,"top":808,"visible":true}
```

so "verified by looking" is a measurement here, not a hope - which is the check I skipped
two iterations ago when I stored an image identical to the previous one and called it the
bottom.

### Correction to iteration 10, immediately after writing it

The geometry line I recorded (`{"found":true,"scrolled":1,"top":808,"visible":true}`) came
from the **previous** run. The run after the flex-wrap change printed `{"found":false}`, and
I committed the record with the stale number in it - a measurement from before the change
presented as evidence for it. That is the same failure this review keeps finding, and this
time I am the one who did it.

The fix is in the capture script, not in the panel: it must **reload the page first** and
report the geometry from the same run as the image, or the number and the picture describe
different builds. A measurement is only evidence if it was taken on the thing being claimed.

## Iteration 11 - the acceptance script, and what one run proved

`scripts/panel-shot.mjs` is now part of the repository. It reloads the page, opens the
panel, **measures**, and captures - in one run, because the number and the picture have to
describe the same build, which is the mistake I made and corrected two iterations ago.

```text
opened: clicked
health line: 还没有允许任何应用，所以什么都不会被记录。在下面添加一个应用即可开始。
buttons: 10 | squeezed (height > 46px): 0 []
destructive warning: {"found":true,"scrolled":1,"top":766,"visible":true}
capture: 1818124 bytes, sha 50b143a94564
```

That is the whole method in five lines: the panel opens, the first thing on it is the
sentence that needs an action, no button is squeezed (the check that caught the flex bug),
and the destructive warning is measured inside the viewport rather than assumed - with the
image from the same run.

**One nit left, seen in the image and left for the next iteration rather than fixed blind:**
the wrapping put each action on its own line, so 暂停采集, 删除全部历史 and 刷新 now stack
vertically. The fix is to move the destructive block to the **end** of the row, so the
routine actions share a line and the destructive one has the line below it. It is a small
reorder and it needs the block read first - which is the rule this phase keeps teaching.

### And the gate caught me again, in the same way

The commit that added `scripts/panel-shot.mjs` went in with `pnpm verify` failing - 2
warnings and 1 error: an unused `readFileSync` import and two `on`-handler preferences.
**I read the gate result after committing instead of before**, which is the second time in
this session and the same mistake as the very first one, where a guard script that did not
parse was committed and I read the failure afterwards.

Fixed forward: the import is gone, the handlers use `addEventListener`, the gate is green
(324 tests, 0 warnings) and the script still measures what it did - `buttons: 10 | squeezed:
0`, `destructive warning: {"found":true,"visible":true}`. The rule that keeps failing is not
"run the gate", it is **read the gate before the commit**, and the report keeps saying so
until it stops happening.

## Iteration 12 - the routine actions share a line, the destructive one does not

Evidence: `docs/assets/panel-2026-10-03-final.png`, and the same run's measurements:

```text
health line: 还没有允许任何应用，所以什么都不会被记录。在下面添加一个应用即可开始。
buttons: 10 | squeezed (height > 46px): 0 []
destructive warning: {"found":true,"scrolled":1,"top":808,"visible":true}
capture: 1817933 bytes, sha f4a365ba6ce2
```

The swap was done by moving lines rather than by matching strings, after two rounds where a
string anchor silently matched nothing: `暂停采集 刷新` share a line, and `删除全部历史` sits
below them with the sentence that says it cannot be undone.

## Against the goal's six criteria

| criterion | how it is satisfied | how it was checked |
|---|---|---|
| ① the actionable sentence first | it is the first thing under the title, above the status line | screenshot, and the status line read from the live page |
| ② language follows the interface | `<html lang>` read once; no plugin-level switch exists | the panel renders in Chinese here and the code has no other path |
| ③ both languages everywhere | title, explanation, headings, bodies, empty states, buttons, placeholders | every string went through `t(en, zh)`; the English side is the fallback |
| ④ no design-document prose, no raw state words | the privacy paragraph rewritten; `running` → `正在采集` | the rendered text was read a section at a time |
| ⑤ one visual system | `SPACE` scale, theme radii, `currentColor`/`opacity`, no hardcoded colour, three button shapes | the 8 hardcoded sites were removed and the danger colour comes from a host token |
| ⑥ empty states and grouping | every section says what it is and what would fill it; destructive action separated with its consequence | screenshot of the panel bottom, with the row measured inside the viewport |

**Six criteria, twelve iterations, and the same lesson four times over**: an unverified
replacement (twice), a declared-but-unused constant (three times), a capture that proved
nothing (once), and a gate read after the commit instead of before (twice). Every one of
them was found by looking at the thing rather than at the code - which is what the panel
work was for.

The headless Chrome started for this work has been closed; `scripts/panel-shot.mjs`
documents how to start it again, and the panel itself is unaffected either way.
