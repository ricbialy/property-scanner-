import XCTest
@testable import PropertyScan

final class ScanSessionStateTests: XCTestCase {
    func testHappyPathTransitions() throws {
        var session = LocalScanSession(
            scanSessionId: UUID(),
            captureId: UUID(),
            state: .draft,
            roomNames: [:],
            createdAt: .now
        )
        try session.transition(to: .capturing)
        try session.transition(to: .localReview)
        try session.transition(to: .queuedUpload)
        try session.transition(to: .uploading)
        try session.transition(to: .processing)
        try session.transition(to: .needsReview)
        try session.transition(to: .completed)
        XCTAssertEqual(session.state, .completed)
    }

    func testPauseResume() throws {
        var session = LocalScanSession(
            scanSessionId: UUID(), captureId: UUID(), state: .capturing,
            roomNames: [:], createdAt: .now
        )
        try session.transition(to: .paused)
        try session.transition(to: .capturing)
        XCTAssertEqual(session.state, .capturing)
    }

    func testRetryableUploadFailure() throws {
        var session = LocalScanSession(
            scanSessionId: UUID(), captureId: UUID(), state: .uploading,
            roomNames: [:], createdAt: .now
        )
        try session.transition(to: .queuedUpload)
        XCTAssertEqual(session.state, .queuedUpload)
    }

    func testIllegalTransitionThrows() {
        var session = LocalScanSession(
            scanSessionId: UUID(), captureId: UUID(), state: .draft,
            roomNames: [:], createdAt: .now
        )
        XCTAssertThrowsError(try session.transition(to: .completed))
        XCTAssertEqual(session.state, .draft)
    }

    func testServerStateRawValuesMatchContract() {
        XCTAssertEqual(ScanSessionState.localReview.rawValue, "local_review")
        XCTAssertEqual(ScanSessionState.queuedUpload.rawValue, "queued_upload")
        XCTAssertEqual(ScanSessionState.needsReview.rawValue, "needs_review")
    }
}
