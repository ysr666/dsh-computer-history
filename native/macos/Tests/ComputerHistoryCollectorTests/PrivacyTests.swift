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
        // A text field without a readable subrole stays fail-closed.
        XCTAssertEqual(
            classifySecureFieldState(
                subroleStatus: .noValue,
                subrole: nil,
                roleStatus: .success,
                role: kAXTextFieldRole as NSString
            ),
            .unreadable
        )
        XCTAssertEqual(
            classifySecureFieldState(
                subroleStatus: .attributeUnsupported,
                subrole: nil,
                roleStatus: .success,
                role: kAXTextFieldRole as NSString
            ),
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
}
