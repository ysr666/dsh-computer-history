import XCTest
@testable import ComputerHistoryCollector

final class PrivacyTests: XCTestCase {
    func testProtectedBundleBaseline() {
        XCTAssertTrue(protectedBundles.contains("com.1password.1password"))
        XCTAssertTrue(protectedBundles.contains("com.apple.keychainaccess"))
    }

    func testSecureFieldClassificationFailsClosed() {
        XCTAssertEqual(isSecureElement(nil), .unreadable)
        XCTAssertEqual(
            classifySecureFieldState(
                subroleStatus: .cannotComplete,
                subrole: nil,
                roleStatus: .success,
                role: nil
            ),
            .unreadable
        )
        XCTAssertEqual(
            classifySecureFieldState(
                subroleStatus: .success,
                subrole: 42 as NSNumber,
                roleStatus: .success,
                role: nil
            ),
            .unreadable
        )
    }

    func testMissingSubroleIsNotUnreadable() {
        // Terminal's focused AXTextArea exposes no subrole
        // (kAXErrorAttributeUnsupported); dropping it as unreadable removed
        // a whole supported adapter from capture.
        XCTAssertEqual(
            classifySecureFieldState(
                subroleStatus: .noValue,
                subrole: nil,
                roleStatus: .success,
                role: kAXTextAreaRole as NSString
            ),
            .notSecure
        )
        XCTAssertEqual(
            classifySecureFieldState(
                subroleStatus: .attributeUnsupported,
                subrole: nil,
                roleStatus: .success,
                role: kAXTextAreaRole as NSString
            ),
            .notSecure
        )
        // Contrast measured on real AppKit elements: NSSecureTextField
        // answers AXSecureTextField, a plain NSTextField answers
        // kAXErrorAttributeUnsupported for the same role. So a readable
        // role without a subrole is not a secure field.
        XCTAssertEqual(
            classifySecureFieldState(
                subroleStatus: .attributeUnsupported,
                subrole: nil,
                roleStatus: .success,
                role: kAXTextFieldRole as NSString
            ),
            .notSecure
        )
        // Only a failed read stays fail-closed.
        XCTAssertEqual(
            classifySecureFieldState(
                subroleStatus: .attributeUnsupported,
                subrole: nil,
                roleStatus: .cannotComplete,
                role: nil
            ),
            .unreadable
        )
    }

    func testMissingFocusedElementAttributeIsNotUnreadable() {
        // Chromium/Electron applications expose no focused-element attribute
        // (VS Code 1.140.0 answers -25212 on the application element and
        // -25204 system-wide, on every retry) while their window attributes
        // read fine. Treating that as unreadable dropped every observation
        // from the editor adapters.
        XCTAssertEqual(
            isSecureElement(nil, readStatus: .noValue),
            .notSecure
        )
        XCTAssertEqual(
            isSecureElement(nil, readStatus: .attributeUnsupported),
            .notSecure
        )
        // A failed read still withholds metadata.
        XCTAssertEqual(
            isSecureElement(nil, readStatus: .cannotComplete),
            .unreadable
        )
        XCTAssertEqual(
            isSecureElement(nil),
            .unreadable
        )
    }

    func testSecureSubroleClassifiesAsSecure() {
        XCTAssertEqual(
            classifySecureFieldState(
                subroleStatus: .success,
                subrole: kAXSecureTextFieldSubrole as NSString,
                roleStatus: .success,
                role: nil
            ),
            .secure
        )
    }

    func testURLAttributeDecoding() {
        // kAXURLAttribute is a CFURL; `value as? String` used to make URL
        // screening inert. Both accepted forms must decode.
        XCTAssertEqual(
            decodeURLAttribute(
                URL(string: "https://example.test/a?b=c")! as CFURL
            ),
            "https://example.test/a?b=c"
        )
        XCTAssertEqual(
            decodeURLAttribute("file:///tmp/demo.txt" as NSString),
            "file:///tmp/demo.txt"
        )
        XCTAssertNil(decodeURLAttribute(nil))
        XCTAssertNil(decodeURLAttribute(42 as NSNumber))
        XCTAssertNil(decodeURLAttribute("" as NSString))
    }
}
