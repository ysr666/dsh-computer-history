import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

private let heartbeatInterval: TimeInterval = 5
private let idleBoundarySeconds: Double = 8 * 60

private struct ObservationFingerprint: Equatable {
    let pid: Int32
    let bundleId: String
    let appName: String?
    let adapter: String
    let windowTitle: String?
    let document: String?
    let url: String?
    let role: String?
    let subrole: String?
    let identifier: String?
    let secure: Bool
    let protected: Bool
    let idleBoundary: Bool
}

private func accessibilityCallback(
    observer: AXObserver,
    element: AXUIElement,
    notification: CFString,
    refcon: UnsafeMutableRawPointer?
) {
    guard let refcon else { return }
    let collector = Unmanaged<Collector>
        .fromOpaque(refcon)
        .takeUnretainedValue()
    collector.captureFrontmost()
}

final class Collector {
    let session = UUID().uuidString

    private var seq = 0
    private var paused = false
    private var sleeping = false
    private var allowedBundles = Set<String>()
    private var blockedBundles = Set<String>()
    private var policyProtectedBundles = Set<String>()
    private var protectedPathPatterns = [String]()
    private var workspaceObservers: [NSObjectProtocol] = []
    private var axObserver: AXObserver?
    private var observedPid: Int32?
    private var observedWindow: AXUIElement?
    private var heartbeatTimer: Timer?
    private var lastAccessibilityTrusted: Bool?
    private var lastObservationFingerprint: ObservationFingerprint?

    func start(initialAccessibilityTrusted: Bool) {
        lastAccessibilityTrusted = initialAccessibilityTrusted
        let center = NSWorkspace.shared.notificationCenter
        workspaceObservers.append(center.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let app = note.userInfo?[
                NSWorkspace.applicationUserInfoKey
            ] as? NSRunningApplication else { return }
            self?.lastObservationFingerprint = nil
            self?.reconcile(app)
        })
        workspaceObservers.append(center.addObserver(
            forName: NSWorkspace.didTerminateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard
                let self,
                let app = note.userInfo?[
                    NSWorkspace.applicationUserInfoKey
                ] as? NSRunningApplication,
                self.observedPid == app.processIdentifier
            else { return }
            self.detachAXObserver()
            self.lastObservationFingerprint = nil
        })
        workspaceObservers.append(center.addObserver(
            forName: NSWorkspace.didLaunchApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard
                let app = note.userInfo?[
                    NSWorkspace.applicationUserInfoKey
                ] as? NSRunningApplication,
                app.isActive
            else { return }
            self?.reconcile(app)
        })
        workspaceObservers.append(center.addObserver(
            forName: NSWorkspace.willSleepNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            self.sleeping = true
            self.detachAXObserver()
            self.lastObservationFingerprint = nil
        })
        workspaceObservers.append(center.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            self.sleeping = false
            self.lastObservationFingerprint = nil
            self.reconcileFrontmost()
        })

        let timer = Timer.scheduledTimer(
            withTimeInterval: heartbeatInterval,
            repeats: true
        ) { [weak self] _ in
            self?.reconcileFrontmost()
        }
        timer.tolerance = 0.5
        heartbeatTimer = timer
        reconcileFrontmost()
    }

    func stop() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil

        let center = NSWorkspace.shared.notificationCenter
        workspaceObservers.forEach(center.removeObserver)
        workspaceObservers.removeAll()
        detachAXObserver()
        lastObservationFingerprint = nil
    }

    func captureFrontmost() {
        guard
            !paused,
            !sleeping,
            let app = NSWorkspace.shared.frontmostApplication
        else { return }
        capture(app)
    }

    private func reconcileFrontmost() {
        guard !paused, !sleeping else { return }
        guard let app = NSWorkspace.shared.frontmostApplication else {
            detachAXObserver()
            lastObservationFingerprint = nil
            return
        }
        reconcile(app)
    }

    private func reconcile(_ app: NSRunningApplication) {
        guard !paused, !sleeping else { return }

        let trusted = AXIsProcessTrusted()
        updateAccessibilityState(trusted)
        guard trusted else {
            detachAXObserver()
            lastObservationFingerprint = nil
            return
        }

        observe(app)
        capture(app)
    }

    private func updateAccessibilityState(_ trusted: Bool) {
        guard lastAccessibilityTrusted != trusted else { return }
        lastAccessibilityTrusted = trusted
        emit(StateMessage(
            state: trusted ? "running" : "permission-required",
            accessibilityTrusted: trusted,
            reason: trusted ? nil : "accessibility"
        ))
    }
    private func detachAXObserver() {
        if let observer = axObserver, let window = observedWindow {
            AXObserverRemoveNotification(
                observer,
                window,
                kAXTitleChangedNotification as CFString
            )
        }
        observedWindow = nil

        if let observer = axObserver {
            CFRunLoopRemoveSource(
                CFRunLoopGetMain(),
                AXObserverGetRunLoopSource(observer),
                .defaultMode
            )
        }
        axObserver = nil
        observedPid = nil
    }

    private func observe(_ app: NSRunningApplication) {
        let bundle = app.bundleIdentifier ?? "unknown"
        let protected = protectedBundles.contains(bundle)
            || policyProtectedBundles.contains(bundle)
        let eligible = !protected
            && !blockedBundles.contains(bundle)
            && phase1AdapterForBundle(bundle) != nil
            && allowedBundles.contains(bundle)
            && AXIsProcessTrusted()

        guard eligible else {
            detachAXObserver()
            return
        }

        if
            observedPid == app.processIdentifier,
            axObserver != nil
        {
            return
        }

        detachAXObserver()

        var created: AXObserver?
        guard
            AXObserverCreate(
                app.processIdentifier,
                accessibilityCallback,
                &created
            ) == .success,
            let observer = created
        else { return }

        axObserver = observer
        observedPid = app.processIdentifier
        let appElement = AXUIElementCreateApplication(
            app.processIdentifier
        )
        // A hung or unresponsive target application must not stall the
        // main run loop: metadata capture shares this thread with the
        // control channel, so a blocked AX call would also blow the
        // Host's acknowledgement budget and take capture down.
        applyMessagingTimeout(appElement)
        let refcon = UnsafeMutableRawPointer(
            Unmanaged.passUnretained(self).toOpaque()
        )
        AXObserverAddNotification(
            observer,
            appElement,
            kAXFocusedWindowChangedNotification as CFString,
            refcon
        )
        AXObserverAddNotification(
            observer,
            appElement,
            kAXFocusedUIElementChangedNotification as CFString,
            refcon
        )
        CFRunLoopAddSource(
            CFRunLoopGetMain(),
            AXObserverGetRunLoopSource(observer),
            .defaultMode
        )
    }

    private func observeWindow(_ window: AXUIElement?) {
        guard let observer = axObserver else {
            observedWindow = nil
            return
        }

        if
            let current = observedWindow,
            let window,
            CFEqual(current, window)
        {
            return
        }

        if let current = observedWindow {
            AXObserverRemoveNotification(
                observer,
                current,
                kAXTitleChangedNotification as CFString
            )
        }
        observedWindow = nil

        guard let window else { return }
        let refcon = UnsafeMutableRawPointer(
            Unmanaged.passUnretained(self).toOpaque()
        )
        if AXObserverAddNotification(
            observer,
            window,
            kAXTitleChangedNotification as CFString,
            refcon
        ) == .success {
            observedWindow = window
        }
    }

    func configure(_ policy: ConfigurePayload) {
        allowedBundles = Set(policy.allowedBundleIds)
        blockedBundles = Set(policy.blockedBundleIds)
        policyProtectedBundles = Set(policy.protectedBundleIds)
        protectedPathPatterns = policy.protectedPathPatterns
        lastObservationFingerprint = nil
        detachAXObserver()

        if !paused && !sleeping {
            reconcileFrontmost()
        }
    }

    func setPaused(_ value: Bool) {
        paused = value
        let trusted = AXIsProcessTrusted()
        lastAccessibilityTrusted = trusted

        if value {
            detachAXObserver()
            lastObservationFingerprint = nil
            emit(StateMessage(
                state: "paused",
                accessibilityTrusted: trusted,
                reason: nil
            ))
            return
        }

        emit(StateMessage(
            state: trusted ? "running" : "permission-required",
            accessibilityTrusted: trusted,
            reason: trusted ? nil : "accessibility"
        ))
        lastObservationFingerprint = nil
        if trusted && !sleeping {
            reconcileFrontmost()
        }
    }

    private func capture(_ app: NSRunningApplication) {
        guard !paused, !sleeping else { return }

        let bundle = app.bundleIdentifier ?? "unknown"
        let protected = protectedBundles.contains(bundle)
            || policyProtectedBundles.contains(bundle)
        guard let adapterName = phase1AdapterForBundle(bundle) else {
            lastObservationFingerprint = nil
            return
        }
        guard
            !protected,
            !blockedBundles.contains(bundle),
            allowedBundles.contains(bundle)
        else {
            lastObservationFingerprint = nil
            return
        }

        let trusted = AXIsProcessTrusted()
        updateAccessibilityState(trusted)
        guard trusted else {
            detachAXObserver()
            lastObservationFingerprint = nil
            return
        }

        let appElement = AXUIElementCreateApplication(
            app.processIdentifier
        )
        // A hung or unresponsive target application must not stall the
        // main run loop: metadata capture shares this thread with the
        // control channel, so a blocked AX call would also blow the
        // Host's acknowledgement budget and take capture down.
        applyMessagingTimeout(appElement)
        var focusedWindowRef: CFTypeRef?
        var focusedElementRef: CFTypeRef?
        AXUIElementCopyAttributeValue(
            appElement,
            kAXFocusedWindowAttribute as CFString,
            &focusedWindowRef
        )
        let focusedElementStatus = AXUIElementCopyAttributeValue(
            appElement,
            kAXFocusedUIElementAttribute as CFString,
            &focusedElementRef
        )
        let window = windowElement(from: focusedWindowRef)
        let element = windowElement(from: focusedElementRef)
        // The timeout applies per element object, so the window and the
        // focused element need their own before any attribute is read.
        if let window { applyMessagingTimeout(window) }
        if let element { applyMessagingTimeout(element) }

        let secureState = isSecureElement(element, readStatus: focusedElementStatus)
        // Window metadata is unlocked only when the focused element is
        // positively not secure: either a readable element without the secure
        // subrole, or an application that exposes no focused-element
        // attribute at all (Chromium/Electron). A failed read still withholds
        // the title/document/URL rather than risk persisting a secure
        // field's surface.
        let metadataAllowed = secureState == .notSecure
        observeWindow(metadataAllowed ? window : nil)

        var windowInfo: WindowInfo?
        if metadataAllowed, let window {
            let document = safeString(
                window,
                kAXDocumentAttribute as String
            )
            let url = safeURL(window, "AXURL")
            if
                isProtectedMetadata(
                    document,
                    patterns: protectedPathPatterns,
                    isResource: true
                )
                || isProtectedMetadata(
                    url,
                    patterns: protectedPathPatterns,
                    isResource: true
                )
            {
                lastObservationFingerprint = nil
                return
            }

            let title = adapterName == "terminal"
                ? nil
                : safeString(
                    window,
                    kAXTitleAttribute as String
                )
            if isProtectedMetadata(
                title,
                patterns: protectedPathPatterns,
                isResource: false
            ) {
                lastObservationFingerprint = nil
                return
            }

            windowInfo = WindowInfo(
                title: title,
                document: document,
                url: url
            )
        }

        var elementInfo: ElementInfo?
        if metadataAllowed, let element {
            let identifier = safeString(
                element,
                kAXIdentifierAttribute as String
            )
            if isProtectedMetadata(
                identifier,
                patterns: protectedPathPatterns,
                isResource: false
            ) {
                lastObservationFingerprint = nil
                return
            }
            elementInfo = ElementInfo(
                role: safeString(element, kAXRoleAttribute as String),
                subrole: safeString(element, kAXSubroleAttribute as String),
                identifier: identifier
            )
        }
        let idle = CGEventSource.secondsSinceLastEventType(
            .combinedSessionState,
            eventType: CGEventType(rawValue: UInt32.max)!
        )

        let fingerprint = ObservationFingerprint(
            pid: app.processIdentifier,
            bundleId: bundle,
            appName: app.localizedName,
            adapter: adapterName,
            windowTitle: windowInfo?.title,
            document: windowInfo?.document,
            url: windowInfo?.url,
            role: elementInfo?.role,
            subrole: elementInfo?.subrole,
            identifier: elementInfo?.identifier,
            secure: secureState != .notSecure,
            protected: false,
            idleBoundary: idle >= idleBoundarySeconds
        )
        guard fingerprint != lastObservationFingerprint else {
            return
        }
        lastObservationFingerprint = fingerprint

        seq += 1
        emit(Observation(
            collectorSession: session,
            seq: seq,
            observedAtMs: Int64(
                Date().timeIntervalSince1970 * 1000
            ),
            app: AppInfo(
                pid: app.processIdentifier,
                bundleId: bundle,
                name: app.localizedName
            ),
            window: windowInfo,
            element: elementInfo,
            activity: Activity(idleSeconds: idle),
            privacy: Privacy(
                secure: secureState != .notSecure,
                protected: false,
                reason: secureState == .secure
                    ? "secure-field"
                    : secureState == .unreadable
                        ? "unreadable-focused-element"
                        : nil
            ),
            source: SourceInfo(adapter: adapterName)
        ))
    }
}
