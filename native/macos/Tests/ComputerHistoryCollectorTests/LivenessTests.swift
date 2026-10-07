import XCTest
@testable import ComputerHistoryCollector

final class LivenessTests: XCTestCase {
    func testChangedStateAlwaysEmits() {
        XCTAssertTrue(shouldEmitObservation(
            fingerprintUnchanged: false,
            lastObservedAt: 100,
            now: 101,
            livenessInterval: 30
        ))
    }

    func testUnchangedStateIsSuppressedUntilThirtySeconds() {
        XCTAssertFalse(shouldEmitObservation(
            fingerprintUnchanged: true,
            lastObservedAt: 100,
            now: 129.999,
            livenessInterval: 30
        ))
        XCTAssertTrue(shouldEmitObservation(
            fingerprintUnchanged: true,
            lastObservedAt: 100,
            now: 130,
            livenessInterval: 30
        ))
    }

    func testFirstObservationEmitsEvenWhenFingerprintLooksUnchanged() {
        XCTAssertTrue(shouldEmitObservation(
            fingerprintUnchanged: true,
            lastObservedAt: nil,
            now: 100,
            livenessInterval: 30
        ))
    }
}
