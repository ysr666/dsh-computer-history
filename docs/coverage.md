# How do the big products get breadth, and where are we narrow?

Written because the question keeps coming back: are we building something too
narrow? The short answer is that the architecture is not the limit - the **policy**
is, deliberately - and there are three concrete ways to widen it, in cost order.

## The pattern the large products use

Publicly observable behaviour, not internals:

1. **The operating system's own semantic layer.** macOS Accessibility, Windows UI
   Automation, Linux AT-SPI: every native application already publishes a tree of
   roles, names and values, and it is the same tree a screen reader uses. This is
   what makes "work with any app" possible without adapting any app - and it is
   exactly what our `macos-ax` collector consumes.
2. **A first-party side channel for the apps where that tree is blind.** Browsers
   and editors are the standard examples: a Chromium window exposes the *page*, not
   the document the user is editing, and an editor's buffer is not in the tree at
   all. The large products ship extensions for exactly those cases - a VS Code
   extension is the common one - because the application itself knows what it is
   doing and the OS does not.
3. **Pixels as the universal fallback.** Where neither works - custom-drawn UI,
   canvas, remote desktops - a screenshot plus a model that emits clicks and keys
   works on anything a human can see, because it does not need the application's
   cooperation at all.

The reason nobody writes a per-app adapter for hundreds of applications is that
layers 1 and 3 make it unnecessary, and layer 2 is needed for a handful of apps
whose state is genuinely hidden.

## What that means for us

| layer | large products | us |
|---|---|---|
| OS semantic tree | yes | yes - `macos-ax`, the whole foundation |
| companion side channel | extensions for browsers/IDEs | yes - browser companion, editor companion, and now a **documented wire format** so any editor can be one |
| pixels | yes, as the fallback | **no, by ADR 0002** - metadata only, no screenshots, no screen vision |
| platforms | macOS + Windows | **macOS only** |

So we are narrow in exactly two places, and neither is an accident:

- **one operating system.** The collector is per-platform work; the model above it
  is not. Windows has UI Automation and Linux has AT-SPI, and both feed the same
  observation shape.
- **no pixels.** This is the boundary that distinguishes us: a screenshot pipeline
  would buy app-agnostic coverage and cost us the property that we never store what
  is on screen. It is a product decision, not a technical gap, and it is reversible
  only with a new ADR and a much larger privacy argument.

## The three ways to widen, cheapest first

1. **Port the collector to Windows (UIA), then Linux (AT-SPI).** Same observation
   shape, same policy, same store. This is the largest coverage win per unit of
   work: two thirds of desktop applications are not on macOS, and none of the
   layers above the collector change.
2. **Make the companion protocol something an application vendor could adopt.**
   Largely done: the wire format is documented, the identity is a claim, and the
   policy decides. What is missing is a reason for a vendor to adopt it - that is a
   distribution question, not an engineering one.
3. **Add pixels - deliberately and narrowly.** If it ever happens, the honest shape
   is narrow: on-device, transient, never stored, with the screen described rather
   than kept. That is a new ADR and a decision for the owner, not for the code.

## What we are not

We are not building an agent that can operate any application. We are building the
record of what happened, which is a different product with a different boundary: an
agent needs to *see* and *act*; a record needs to be *true*, *cheap* and
*forgettable*. Breadth matters to us for coverage of the record, not for control of
the machine - and that is why the companion and the collector, not a vision model,
are the right places to invest.
