// Bring a target application to the front for a frontmost-app test, without
// fighting the user for focus: it waits until the session has been idle, then
// raises the window and activates the app.
//
//   bin/verify/activate --pid <pid> [--marker <text>] [--budget <seconds>] [--list]
//
//   --list        print the app's AX windows (title/document) and exit
//   --marker      raise the window whose title or document contains this text;
//                 without it the first window is raised
//   --budget      give up after this many seconds (default 40)
//
// Exit codes: 0 when the target became frontmost, 1 when it did not.
import AppKit
import ApplicationServices
import Foundation

func stringAttribute(_ element: AXUIElement, _ name: String) -> String {
    var reference: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &reference) == .success else {
        return ""
    }
    return (reference as? String) ?? ""
}

func windows(of pid: pid_t) -> [AXUIElement] {
    let app = AXUIElementCreateApplication(pid)
    var reference: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
        app,
        kAXWindowsAttribute as CFString,
        &reference
    ) == .success else { return [] }
    return (reference as? [AXUIElement]) ?? []
}

func idleSeconds() -> Double {
    CGEventSource.secondsSinceLastEventType(
        .combinedSessionState,
        eventType: CGEventType(rawValue: UInt32.max)!
    )
}

var pid: pid_t?
var marker: String?
var budget: Double = 40
var listOnly = false

var index = 1
let arguments = CommandLine.arguments
while index < arguments.count {
    switch arguments[index] {
    case "--pid":
        pid = pid_t(arguments[index + 1])
        index += 2
    case "--marker":
        marker = arguments[index + 1]
        index += 2
    case "--budget":
        budget = Double(arguments[index + 1]) ?? 40
        index += 2
    case "--list":
        listOnly = true
        index += 1
    case "--help", "-h":
        print("usage: activate --pid <pid> [--marker <text>] [--budget <seconds>] [--list]")
        exit(0)
    default:
        print("unknown option: \(arguments[index])")
        exit(2)
    }
}

guard let targetPid = pid else {
    print("usage: activate --pid <pid> [--marker <text>] [--budget <seconds>] [--list]")
    exit(2)
}

let all = windows(of: targetPid)
let described = all.map { window in
    (window, stringAttribute(window, kAXTitleAttribute as String), stringAttribute(window, kAXDocumentAttribute as String))
}
print("windows: \(all.count)")
for (offset, entry) in described.enumerated() {
    print("  [\(offset)] title=\(entry.1) document=\(entry.2)")
}
if listOnly { exit(0) }

let selected: AXUIElement?
if let marker {
    selected = described.first { $0.1.contains(marker) || $0.2.contains(marker) }?.0
} else {
    selected = described.first?.0
}

guard let window = selected else {
    print(marker == nil ? "application exposes no window" : "no window matches \(marker!)")
    exit(1)
}

let appElement = AXUIElementCreateApplication(targetPid)
let deadline = Date().addingTimeInterval(budget)
var attempts = 0
while Date() < deadline {
    let idle = idleSeconds()
    if idle >= 1.2 {
        attempts += 1
        _ = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
        AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
        AXUIElementSetAttributeValue(window, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        AXUIElementSetAttributeValue(appElement, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
        if let running = NSRunningApplication(processIdentifier: targetPid) {
            running.activate(options: [.activateAllWindows])
        }
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == targetPid {
            print("frontmost after \(attempts) attempt(s), idle=\(String(format: "%.1f", idle))s")
            exit(0)
        }
    }
    usleep(400_000)
}

let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
print("gave up after \(attempts) attempt(s); frontmost is pid \(frontmost)")
exit(1)
