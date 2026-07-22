import XCTest
@testable import PropertyScan

final class CaptureManifestTests: XCTestCase {
    private let roomId = UUID()
    private let roomData = Data(#"{"version":2}"#.utf8)

    private func buildManifest() throws -> CaptureManifest {
        try ManifestBuilder.build(
            scanSessionId: UUID(),
            captureId: UUID(),
            device: .init(model: "iPhone16,1", osVersion: "18.5", appVersion: "0.1.0", lidar: true),
            startedAt: Date(timeIntervalSince1970: 1_700_000_000),
            completedAt: Date(timeIntervalSince1970: 1_700_000_600),
            rooms: [(roomId: roomId, name: "Kitchen", path: "roomplan/room.json")],
            structureFile: nil,
            fileContents: ["roomplan/room.json": roomData],
            contentTypes: ["roomplan/room.json": "application/json"]
        )
    }

    func testChecksumMatchesKnownVector() {
        // SHA-256 of the empty string — a fixed vector guarding the hex encoding.
        XCTAssertEqual(
            ManifestBuilder.sha256Hex(Data()),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        )
    }

    func testManifestHashesRealBytes() throws {
        let manifest = try buildManifest()
        XCTAssertEqual(manifest.files.count, 1)
        XCTAssertEqual(manifest.files[0].byteSize, roomData.count)
        XCTAssertEqual(manifest.files[0].sha256, ManifestBuilder.sha256Hex(roomData))
        XCTAssertEqual(manifest.units, "meters")
        XCTAssertEqual(manifest.coordinateSystem.transformSerialization, "column-major")
    }

    func testMissingRoomFileThrows() {
        XCTAssertThrowsError(try ManifestBuilder.build(
            scanSessionId: UUID(),
            captureId: UUID(),
            device: .init(model: "iPhone16,1", osVersion: "18.5", appVersion: "0.1.0", lidar: true),
            startedAt: .now,
            completedAt: .now,
            rooms: [(roomId: UUID(), name: nil, path: "roomplan/missing.json")],
            structureFile: nil,
            fileContents: [:],
            contentTypes: [:]
        ))
    }

    func testEncodingContainsNoTokenFields() throws {
        let data = try ManifestBuilder.encode(try buildManifest())
        let text = String(decoding: data, as: UTF8.self).lowercased()
        XCTAssertFalse(text.contains("\"token\""))
        XCTAssertFalse(text.contains("\"authorization\""))
        XCTAssertFalse(text.contains("\"secret\""))
    }
}
