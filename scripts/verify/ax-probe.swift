// Reproduce the collector's focused-element and window metadata reads for one
// PID, without going through the Host. Build with `pnpm verify:tools`.
//
//   bin/verify/ax-probe <pid> [rounds]
//
// Prints, per round: the focused-element read status, the focused window's
// role/subrole/document/URL/title, and how long the subrole read took. This is
// the tool that produced the F4/F11 evidence (a missing subrole is not a
// failed read; Chromium applications expose no app-level focused element).
import ApplicationServices
import Foundation

func attribute(_ element: AXUIElement, _ name: String) -> (AXError, CFTypeRef?) {
    var value: CFTypeRef?
    let status = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return (status, value)
}

func describeFocused(_ element: AXUIElement) {
    let started = Date()
    let (subroleStatus, subrole) = attribute(element, kAXSubroleAttribute as String)
    let subroleMs = Date().timeIntervalSince(started) * 1000
    let (roleStatus, role) = attribute(element, kAXRoleAttribute as String)
    print(String(
        format: "%@ role(err=%d value=%@) subrole(err=%d value=%@ type=%@) subroleReadMs=%.1f",
        "  focusedElement",
        roleStatus.rawValue,
        String(describing: role),
        subroleStatus.rawValue,
        String(describing: subrole),
        subrole == nil ? "nil" : "\(CFGetTypeID(subrole!))",
        subroleMs
    ))
}

let arguments = CommandLine.arguments
guard arguments.count > 1, let pid = pid_t(arguments[1]) else {
    print("usage: ax-probe <pid> [rounds]")
    exit(2)
}
let rounds = arguments.count > 2 ? Int(arguments[2]) ?? 1 : 1
let app = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(app, 1.0)

for round in 1...rounds {
    let (focusedStatus, focused) = attribute(app, kAXFocusedUIElementAttribute as String)
    let (windowStatus, window) = attribute(app, kAXFocusedWindowAttribute as String)
    print("round \(round): focusedUIElement(err=\(focusedStatus.rawValue)) focusedWindow(err=\(windowStatus.rawValue))")

    if let focused, CFGetTypeID(focused) == AXUIElementGetTypeID() {
        let element = unsafeBitCast(focused, to: AXUIElement.self)
        AXUIElementSetMessagingTimeout(element, 0.5)
        describeFocused(element)
    } else {
        let kind = focused == nil ? "nil" : "\(CFGetTypeID(focused!))"
        print("  focusedElement: not an AXUIElement (type=\(kind))")
    }

    if let window, CFGetTypeID(window) == AXUIElementGetTypeID() {
        let element = unsafeBitCast(window, to: AXUIElement.self)
        AXUIElementSetMessagingTimeout(element, 0.5)
        let (windowRoleStatus, windowRole) = attribute(element, kAXRoleAttribute as String)
        let (subroleStatus, subrole) = attribute(element, kAXSubroleAttribute as String)
        print("  focusedWindow  role(err=\(windowRoleStatus.rawValue) value=\(String(describing: windowRole))) subrole(err=\(subroleStatus.rawValue) value=\(String(describing: subrole)))")
        let (documentStatus, document) = attribute(element, kAXDocumentAttribute as String)
        let (urlStatus, url) = attribute(element, kAXURLAttribute as String)
        let (titleStatus, title) = attribute(element, kAXTitleAttribute as String)
        print("  window document(err=\(documentStatus.rawValue) value=\(String(describing: document)))")
        print("  window axurl(err=\(urlStatus.rawValue) value=\(String(describing: url)))")
        print("  window title(err=\(titleStatus.rawValue) value=\(String(describing: title)))")
    }
    if round < rounds { Thread.sleep(forTimeInterval: 0.8) }
}
