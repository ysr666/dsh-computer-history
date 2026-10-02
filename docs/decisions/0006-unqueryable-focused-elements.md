# ADR 0006: Applications whose focused element is not queryable

Status: Accepted
Date: 2026-10-02
Accepted by: project owner (chose option 3, the per-adapter declaration)

## Context

The collector classifies a surface by reading the focused element's
role/subrole. `isSecureElement` treats `kAXErrorAttributeUnsupported` (-25205)
and `kAXErrorNoValue` (-25212) as positive evidence that the element is not a
secure field, because a native secure field is always readable
(`AXTextField` + `AXSecureTextField`, measured on the Phase 1 fixture). Any
other failure is treated as unreadable, and an unreadable focused element makes
the whole observation fail closed.

IntelliJ-platform applications (measured on Android Studio, bundle
`com.google.android.studio`, 2026-10-02 with
`bin/verify/ax-probe <pid> 1 --attributes`) return a third shape:

```text
focusedUIElement(err=0)                      # an element reference is handed out
  role(err=-25202) subrole(err=-25202)       # kAXErrorIllegalArgument
  attributeNames(err=-25202 count=0)         # even the attribute list fails
  AXRole/AXSubrole/AXTitle: absent
parent: not readable
focusedWindow role=AXWindow subrole=AXStandardWindow   # the window is fully readable
window document(err=-25212) axurl(err=-25205) title=ok
```

So the element is not "an element missing an attribute" (-25205, which would
list its other attributes) and not "an empty attribute" (-25212): the reference
is not queryable at all. The current rule therefore drops every observation
from these applications, which is why the JetBrains family cannot be covered
even though ADR 0002 allows their window metadata.

## Options

1. **Keep failing closed.** IntelliJ-family applications stay unsupported. No
   privacy risk, a permanent coverage gap for a large editor family.
2. **Treat an unqueryable element as not secure, globally.** Maximum coverage,
   and it re-opens the exact failure mode F11 was: a classifier conclusion
   drawn from an error code that may just mean "this AX bridge is limited".
   Rejected.
3. **Per-adapter declaration.** Add `focusedElementPolicy: 'require' |
   'window-only'` to the adapter table. `window-only` means: this application's
   AX bridge does not expose focused elements and its own UI renders text
   fields itself (Java/Swing fields are not `NSSecureTextField`), so a
   window-level observation is recorded **without** element metadata. The
   declaration is data, reviewed like any other adapter field, and a native
   secure field would still be readable — which is what the fixture keeps
   proving.

## Decision

Option 3, with the three conditions:

1. `window-only` adapters record **no** element fields when the element is not
   queryable; a *readable* element still gets full classification, so a native
   secure field always withholds the observation.
2. The privacy matrix gains a case per `window-only` adapter: a native secure
   dialog in that application must still drop the observation.
3. `docs/adapters.md` and the adapter table state that the application is
   recorded window-only, so the reduced evidence is visible rather than
   implied.

## Implementation

- `SecureFieldState` gains `.unqueryable`: `kAXErrorIllegalArgument` from the
  subrole read is its own state, distinct from a failed element fetch, which
  stays `.unreadable`.
- `Phase1Adapter.focusedElementPolicy` (`.require` / `.windowOnly`) is part of
  the adapter table on both sides, and the repository guard compares it.
- The collector accepts `.unqueryable` only for a `.windowOnly` adapter, emits
  the observation with **no element fields** and
  `privacy.reason = "focused-element-unqueryable"`, and keeps withholding
  metadata for `.secure` and `.unreadable` exactly as before.
- The `jetbrains` adapter covers the IntelliJ family; only `windowOnly`
  adapters may use the tolerance.

## Evidence

- Collector level, real machine: the plain and secure fixtures claimed
  `com.google.android.studio`. Plain → one observation with a title and
  `element.role = AXTextField`; secure → `privacy.secure = true`,
  `reason = "secure-field"`, no title and no element.
- Host level, same fixtures: plain added **2 stored rows**, secure added
  **0 rows**. The control is what makes the second number mean anything.
- Real application: Android Studio produced four stored observations
  (`Welcome to Android Studio`, `element_role = AXButton`, no resource).
- Not reproduced later: the unqueryable state itself. It was measured twice
  during Android Studio's startup phase (`role`, `subrole`, the attribute list
  and the parent all failing), but twelve samples across a later cold start
  read a normal `AXButton` with 23 attributes. No stored row carries
  `focused-element-unqueryable` yet, so the tolerance is proven by the fixture
  pair and by the preconditions, not by a live row.

## Consequences

- The IntelliJ family is coverable, with window metadata only when the
  application exposes no queryable element.
- The classifier still fails closed for every failure it cannot identify, and
  the one exception lives in data a reviewer can see.
