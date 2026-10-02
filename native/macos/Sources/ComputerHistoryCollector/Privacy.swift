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
    // element has no subrole attribute at all, which is normal for many
    // focused elements (AXTextArea in Terminal, AXGroup in other apps). A
    // secure text field is *defined* by the AXSecureTextField subrole, so
    // an element without one cannot be a secure field — but keep failing
    // closed for the one role that can carry that subrole, so a hidden or
    // dropped subrole on a text field never unlocks window metadata.
    if
        subroleStatus == .attributeUnsupported
        || subroleStatus == .noValue
    {
        guard
            roleStatus == .success,
            let value = role as? String
        else { return .unreadable }
        return value == kAXTextFieldRole as String
            ? .unreadable
            : .notSecure
    }

    // Timeouts, invalid elements, and every other failure remain
    // indistinguishable from a secure surface: fail closed.
    return .unreadable
}

func isSecureElement(_ element: AXUIElement?) -> SecureFieldState {
    // A nil focused element means the read failed or the application
    // exposes no focused element. The two are indistinguishable from
    // here, so treat the surface as unreadable and withhold metadata
    // rather than risk recording a secure field's window.
    guard let element else { return .unreadable }

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

/// `kAXURLAttribute` is documented as a CFURL, so `as? String` would
/// silently produce nil and make URL screening inert. Accept either the
/// URL form or the legacy string form, and reject anything else.
func safeURL(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: CFTypeRef?
    guard
        AXUIElementCopyAttributeValue(
            element,
            attribute as CFString,
            &value
        ) == .success,
        let value
    else { return nil }

    if CFGetTypeID(value) == CFURLGetTypeID() {
        let url = unsafeBitCast(value, to: CFURL.self)
        return (url as URL).absoluteString
    }
    if let text = value as? String, !text.isEmpty {
        return text
    }
    return nil
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
