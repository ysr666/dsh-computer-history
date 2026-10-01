import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

private func accessibilityCallback(
    observer: AXObserver,
    element: AXUIElement,
    notification: CFString,
    refcon: UnsafeMutableRawPointer?
) {
    guard let refcon else { return }
    let collector = Unmanaged<Collector>.fromOpaque(refcon).takeUnretainedValue()
    collector.captureFrontmost()
}

final class Collector {
    let session = UUID().uuidString
    private var seq = 0
    private var paused = false
    private var policyMode = "include-only"
    private var allowedBundles = Set<String>()
    private var blockedBundles = Set<String>()
    private var policyProtectedBundles = Set<String>()
    private var protectedPathPatterns = [String]()
    private var workspaceObservers: [NSObjectProtocol] = []
    private var axObserver: AXObserver?

    func start() {
        let center = NSWorkspace.shared.notificationCenter
        workspaceObservers.append(center.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            self?.observe(app)
            self?.capture(app)
        })
        if let app = NSWorkspace.shared.frontmostApplication { observe(app); capture(app) }
    }

    func stop() {
        let center = NSWorkspace.shared.notificationCenter
        workspaceObservers.forEach(center.removeObserver)
        workspaceObservers.removeAll()
        if let observer = axObserver {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
        }
        axObserver = nil
    }

    func captureFrontmost() {
        guard let app = NSWorkspace.shared.frontmostApplication else { return }
        capture(app)
    }

    private func observe(_ app: NSRunningApplication) {
        if let observer = axObserver {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
        }
        axObserver = nil
        var created: AXObserver?
        guard AXObserverCreate(app.processIdentifier, accessibilityCallback, &created) == .success,
              let observer = created else { return }
        axObserver = observer
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        let refcon = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
        AXObserverAddNotification(observer, appElement, kAXFocusedWindowChangedNotification as CFString, refcon)
        AXObserverAddNotification(observer, appElement, kAXFocusedUIElementChangedNotification as CFString, refcon)
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
    }

    func configure(_ policy: ConfigurePayload) {
        policyMode = policy.mode
        allowedBundles = Set(policy.allowedBundleIds)
        blockedBundles = Set(policy.blockedBundleIds)
        policyProtectedBundles = Set(policy.protectedBundleIds)
        protectedPathPatterns = policy.protectedPathPatterns
        if !paused, let app = NSWorkspace.shared.frontmostApplication { capture(app) }
    }

    func setPaused(_ value: Bool) {
        paused = value
        emit(StateMessage(state: value ? "paused" : "running", accessibilityTrusted: AXIsProcessTrusted(), reason: nil))
        if !value, let app = NSWorkspace.shared.frontmostApplication { capture(app) }
    }

    private func capture(_ app: NSRunningApplication) {
        guard !paused else { return }
        let bundle = app.bundleIdentifier ?? "unknown"
        let protected = protectedBundles.contains(bundle) || policyProtectedBundles.contains(bundle)
        if protected || browserBundles.contains(bundle) || blockedBundles.contains(bundle) { return }
        if policyMode == "include-only" && !allowedBundles.contains(bundle) { return }
        let trusted = AXIsProcessTrusted()
        if !trusted {
            emit(StateMessage(state: "permission-required", accessibilityTrusted: false, reason: "accessibility"))
        }

        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        var focusedWindowRef: CFTypeRef?
        var focusedElementRef: CFTypeRef?
        AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &focusedWindowRef)
        AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focusedElementRef)
        let window = focusedWindowRef.map { unsafeBitCast($0, to: AXUIElement.self) }
        let element = focusedElementRef.map { unsafeBitCast($0, to: AXUIElement.self) }
        if let observer = axObserver, let window {
            let refcon = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
            AXObserverAddNotification(observer, window, kAXTitleChangedNotification as CFString, refcon)
        }
        let secure = isSecureElement(element)

        seq += 1
        let windowInfo: WindowInfo? = protected || secure ? nil : window.map {
            WindowInfo(
                title: safeString($0, kAXTitleAttribute as String),
                document: safeString($0, kAXDocumentAttribute as String),
                url: safeString($0, "AXURL")
            )
        }
        if let document = windowInfo?.document,
           protectedPathPatterns.contains(where: { globMatches($0, document) }) {
            return
        }
        let elementInfo: ElementInfo? = protected || secure ? nil : element.map {
            ElementInfo(
                role: safeString($0, kAXRoleAttribute as String),
                subrole: safeString($0, kAXSubroleAttribute as String),
                identifier: safeString($0, kAXIdentifierAttribute as String),
                title: nil
            )
        }
        let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: UInt32.max)!)
        emit(Observation(
            collectorSession: session, seq: seq,
            observedAtMs: Int64(Date().timeIntervalSince1970 * 1000),
            app: AppInfo(pid: app.processIdentifier, bundleId: bundle, name: app.localizedName),
            window: windowInfo, element: elementInfo, activity: Activity(idleSeconds: idle),
            privacy: Privacy(secure: secure, protected: protected, reason: protected ? "protected-app" : secure ? "secure-field" : nil),
            source: SourceInfo(adapter: adapter(bundle))
        ))
    }

    private func adapter(_ bundle: String) -> String {
        if bundle == "com.microsoft.VSCode" || bundle.contains("cursor") { return "vscode" }
        if bundle == "com.apple.Terminal" || bundle.contains("iterm") { return "terminal" }
        if bundle == "com.apple.Preview" { return "preview" }
        if bundle == "com.apple.finder" { return "finder" }
        return "generic"
    }
}
