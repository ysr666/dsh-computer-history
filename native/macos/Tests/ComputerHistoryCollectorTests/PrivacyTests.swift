import XCTest
@testable import ComputerHistoryCollector

final class PrivacyTests: XCTestCase {
    func testProtectedBundleBaseline() {
        XCTAssertTrue(protectedBundles.contains("com.1password.1password"))
        XCTAssertTrue(protectedBundles.contains("com.apple.keychainaccess"))
    }
}
