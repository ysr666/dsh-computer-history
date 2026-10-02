// Synthetic Phase 1 fixture application.
//
//   fixture-app <secure|plain|hung> <represented-path> [window-title]
//
//   secure  focused NSSecureTextField (real AXSecureTextField subrole, never
//           filled — synthetic, no credentials)
//   plain   focused NSTextField
//   hung    plain field, then blocks the main thread for 6 seconds so the
//           collector's per-element AX timeout can be measured
//
// The window represents <represented-path> so kAXDocument is populated. The
// bundle identity comes from the Info.plist that build-fixture.mjs writes; the
// app deliberately has no opinion about it.
import AppKit

let arguments = CommandLine.arguments
guard arguments.count > 2 else {
    print("usage: fixture-app <secure|plain|hung> <represented-path> [window-title]")
    exit(2)
}
let mode = arguments[1]
let representedPath = arguments[2]
let titleOverride = arguments.count > 3 ? arguments[3] : nil

let app = NSApplication.shared
app.setActivationPolicy(.regular)

let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 640, height: 320),
    styleMask: [.titled, .closable],
    backing: .buffered,
    defer: false
)
window.title = titleOverride ?? "dsh-fixture-\(mode)"
window.representedURL = URL(fileURLWithPath: representedPath)

let field: NSTextField
if mode == "secure" {
    let secure = NSSecureTextField(
        frame: NSRect(x: 24, y: 150, width: 420, height: 24)
    )
    secure.placeholderString = "synthetic secure field (never filled)"
    field = secure
} else {
    let plain = NSTextField(
        frame: NSRect(x: 24, y: 150, width: 420, height: 24)
    )
    plain.placeholderString = "synthetic plain field"
    field = plain
}
window.contentView?.addSubview(field)
window.makeKeyAndOrderFront(nil)
window.makeFirstResponder(field)
app.activate(ignoringOtherApps: true)

// A tool-driven shell can pull another application forward right after launch,
// so re-assert frontmost status for the first seconds.
var activations = 0
let activationTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { timer in
    activations += 1
    window.makeKeyAndOrderFront(nil)
    app.activate(ignoringOtherApps: true)
    if activations >= 30 { timer.invalidate() }
}
RunLoop.main.add(activationTimer, forMode: .common)

if mode == "hung" {
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
        let end = Date().addingTimeInterval(6)
        while Date() < end {
            // Deliberately block the main thread (AX reads must time out).
        }
    }
}

DispatchQueue.main.asyncAfter(deadline: .now() + 22) {
    app.terminate(nil)
}
app.run()
