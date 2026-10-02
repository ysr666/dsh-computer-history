# ADR 0006: Applications whose focused element is not queryable

Status: Proposed (blocks JetBrains-family coverage until decided)
Date: 2026-10-02

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

Not yet taken. The conservative default (option 1) stays in force until the
project owner decides, because option 3 changes what the collector accepts as
evidence for a privacy conclusion.

## Recommendation

Option 3, with three conditions:

- `window-only` adapters record **no** element fields at all (no role, no
  identifier), so the missing evidence cannot be mistaken for a clean read.
- The privacy test matrix gains a case per `window-only` adapter: a native
  secure dialog in that application must still drop the observation.
- The panel and `docs/adapters.md` state that these applications are recorded
  window-only, so the reduced evidence is visible rather than implied.

## Consequences if accepted

- JetBrains-family adapters (and other Swing/AWT applications) become
  coverable, with a documented reduction in evidence granularity.
- The classifier itself does not change: `-25202` keeps meaning "unreadable",
  and the exception lives in data that a reviewer can see.
