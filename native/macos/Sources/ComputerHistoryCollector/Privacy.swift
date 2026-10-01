import ApplicationServices
import Foundation

let protectedBundles: Set<String> = [
    "com.1password.1password", "com.bitwarden.desktop", "com.apple.keychainaccess",
    "com.dashlane.Dashlane", "com.lastpass.LastPass"
]

func isSecureElement(_ element: AXUIElement?) -> Bool {
    guard let element else { return false }
    var subrole: CFTypeRef?
    AXUIElementCopyAttributeValue(element, kAXSubroleAttribute as CFString, &subrole)
    let s = subrole as? String
    return s == kAXSecureTextFieldSubrole as String
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
