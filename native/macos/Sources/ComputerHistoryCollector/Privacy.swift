import ApplicationServices
import Foundation

let protectedBundles: Set<String> = [
    "com.1password.1password", "com.bitwarden.desktop", "com.apple.keychainaccess",
    "com.dashlane.Dashlane", "com.lastpass.LastPass"
]

enum SecureFieldState: Equatable {
    case secure
    case notSecure
    /// The focused element or its subrole could not be read. Callers
    /// must treat this exactly like `.secure`: an unreadable element is
    /// not evidence that the surface is safe to record.
    case unreadable
    /// The application handed out an element reference that rejects every
    /// attribute read (`kAXErrorIllegalArgument`). Measured on the IntelliJ
    /// platform (Android Studio, 2026-10-02): role, subrole and even the
    /// attribute list answer -25202 while the window reads normally. This is
    /// "the application exposes no queryable element", not "we could not
    /// ask", so an adapter that declares itself window-only (ADR 0006) may
    /// record window metadata without element fields. Every other caller
    /// keeps treating it as unreadable.
    case unqueryable
}

let sensitiveResourceMarker = try! NSRegularExpression(
    pattern: "(?:^|/)(?:\\.env(?:\\.|$)|\\.ssh(?:/|$))|\\.(?:pem|key)$|(?:credentials|secrets)",
    options: [.caseInsensitive]
)

/// The only safe way to leave an accessibility attribute copy. The copy
/// can return a non-element CFType (or fail outright), and a blind
/// `unsafeBitCast` would then reinterpret arbitrary memory.
func windowElement(from ref: CFTypeRef?) -> AXUIElement? {
    guard
        let ref,
        CFGetTypeID(ref) == AXUIElementGetTypeID()
    else { return nil }
    return unsafeBitCast(ref, to: AXUIElement.self)
}

/// Bound every accessibility round trip for this element. The timeout is
/// per element object, so it must be applied to each one whose attributes
/// are read, not only to the application element.
func applyMessagingTimeout(_ element: AXUIElement) {
    AXUIElementSetMessagingTimeout(element, 0.5)
}

/// Classify the focused element from its already-read subrole/role
/// attribute results. Split from the accessibility reads so every branch —
/// including "the attribute does not exist" — is unit-testable without a
/// GUI session.
func classifySecureFieldState(
    subroleStatus: AXError,
    subrole: CFTypeRef?,
    roleStatus: AXError,
    role: CFTypeRef?
) -> SecureFieldState {
    if subroleStatus == .success {
        // A successful copy that yields a non-string subrole is not
        // usable evidence that the surface is safe.
        guard let value = subrole as? String else { return .unreadable }
        return value == kAXSecureTextFieldSubrole as String
            ? .secure
            : .notSecure
    }

    // `kAXErrorAttributeUnsupported` and `kAXErrorNoValue` both mean the
    // element has no subrole attribute at all. Measured on real AppKit
    // elements: a secure field answers `AXSecureTextField`, while plain
    // `NSTextField`s and Terminal's `AXTextArea` have no subrole and answer
    // exactly these two errors. The absence of the attribute is therefore
    // positive evidence that the element is not a secure field — but the
    // role read must itself succeed, so an element we cannot classify at
    // all still fails closed.
    if
        subroleStatus == .attributeUnsupported
        || subroleStatus == .noValue
    {
        guard
            roleStatus == .success,
            role as? String != nil
        else { return .unreadable }
        return .notSecure
    }

    // The element reference exists but the API rejects reads on it. Only a
    // declared window-only adapter may use this as evidence, and only because
    // a genuinely secure field is always readable — see ADR 0006.
    if subroleStatus == .illegalArgument {
        return .unqueryable
    }

    // Timeouts, invalid elements, and every other failure remain
    // indistinguishable from a secure surface: fail closed.
    return .unreadable
}

func isSecureElement(
    _ element: AXUIElement?,
    readStatus: AXError = .success
) -> SecureFieldState {
    // A nil focused element has two very different causes, and `readStatus`
    // is the only thing that tells them apart:
    //
    // - `attributeUnsupported` / `noValue`: the application has no
    //   focused-element attribute at all. Measured on real Chromium/Electron
    //   apps (VS Code 1.140.0): the application element answers -25212 and
    //   the system-wide element -25204 on every retry, while the window
    //   attributes (title, document) read fine. There is no focused element
    //   we could be missing, so this is positive evidence, exactly like a
    //   missing subrole.
    // - anything else (timeouts, invalid elements, API disabled): the read
    //   failed. We could not ask, so the surface stays unreadable and the
    //   metadata is withheld.
    //
    // Before this distinction existed, the first case dropped every
    // observation from the editor adapters — the same fail-closed false
    // positive that removed Terminal from capture.
    guard let element else {
        switch readStatus {
        case .attributeUnsupported, .noValue:
            return .notSecure
        default:
            return .unreadable
        }
    }

    var subrole: CFTypeRef?
    let subroleStatus = AXUIElementCopyAttributeValue(
        element,
        kAXSubroleAttribute as CFString,
        &subrole
    )

    var role: CFTypeRef?
    var roleStatus: AXError = .success
    if
        subroleStatus == .attributeUnsupported
        || subroleStatus == .noValue
    {
        roleStatus = AXUIElementCopyAttributeValue(
            element,
            kAXRoleAttribute as CFString,
            &role
        )
    }

    return classifySecureFieldState(
        subroleStatus: subroleStatus,
        subrole: subrole,
        roleStatus: roleStatus,
        role: role
    )
}

func looksLikeSensitiveResourcePath(_ value: String) -> Bool {
    let decoded = value.removingPercentEncoding ?? value
    return sensitiveResourceMarker.firstMatch(
        in: decoded,
        range: NSRange(decoded.startIndex..., in: decoded)
    ) != nil
}

/// Windows into an observation are dropped unless a rule proves they are
/// safe. `isResource` additionally applies the built-in sensitive-path
/// heuristic, which is appropriate for a location but far too blunt for
/// a human-readable window title.
func isProtectedMetadata(
    _ value: String?,
    patterns: [String],
    isResource: Bool
) -> Bool {
    guard let value, !value.isEmpty else { return false }
    let decoded = value.removingPercentEncoding ?? value

    if patterns.contains(where: {
        globMatches($0, value) || globMatches($0, decoded)
    }) {
        return true
    }
    return isResource && looksLikeSensitiveResourcePath(value)
}

/// Decode one accessibility attribute value that may carry a URL.
///
/// Split from the read so both accepted forms are unit-testable: a real
/// CFURL (`kAXURLAttribute` is documented as CFURL, and `value as? String`
/// silently produced nil for it, making URL screening inert) and the legacy
/// string form. Anything else is not usable evidence and yields nil.
func decodeURLAttribute(_ value: CFTypeRef?) -> String? {
    guard let value else { return nil }

    if CFGetTypeID(value) == CFURLGetTypeID() {
        let url = unsafeBitCast(value, to: CFURL.self)
        return (url as URL).absoluteString
    }
    if let text = value as? String, !text.isEmpty {
        return text
    }
    return nil
}

func safeURL(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: CFTypeRef?
    guard
        AXUIElementCopyAttributeValue(
            element,
            attribute as CFString,
            &value
        ) == .success
    else { return nil }

    return decodeURLAttribute(value)
}

func safeString(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
    return value as? String
}



func globMatches(_ pattern: String, _ value: String) -> Bool {
    let p = Array(pattern), v = Array(value)
    var pi = 0, vi = 0, star = -1, starValue = -1
    while vi < v.count {
        if pi < p.count && p[pi] == v[vi] { pi += 1; vi += 1 }
        else if pi < p.count && p[pi] == "*" { star = pi; pi += 1; starValue = vi }
        else if star >= 0 { pi = star + 1; starValue += 1; vi = starValue }
        else { return false }
    }
    while pi < p.count && p[pi] == "*" { pi += 1 }
    return pi == p.count
}
