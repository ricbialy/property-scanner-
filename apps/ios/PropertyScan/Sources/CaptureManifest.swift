import CryptoKit
import Foundation

/// Capture bundle manifest matching the server contract
/// (`@propertyscan/contracts` captureManifestSchema, schemaVersion 1.0).
/// Must never contain authentication tokens.
struct CaptureManifest: Codable, Equatable {
    static let schemaVersion = "1.0"

    struct Device: Codable, Equatable {
        var model: String
        var osVersion: String
        var appVersion: String
        var lidar: Bool
    }

    struct CoordinateSystem: Codable, Equatable {
        var handedness = "right"
        var up = "+y"
        var transformSerialization = "column-major"
    }

    struct CapturedAt: Codable, Equatable {
        var startedAt: Date
        var completedAt: Date
    }

    struct Room: Codable, Equatable {
        var roomId: UUID
        var name: String?
        var roomplanFile: String
    }

    struct FileEntry: Codable, Equatable {
        var path: String
        var byteSize: Int
        var sha256: String
        var contentType: String
    }

    var schemaVersion = CaptureManifest.schemaVersion
    var scanSessionId: UUID
    var captureId: UUID
    var device: Device
    var units = "meters"
    var coordinateSystem = CoordinateSystem()
    var capturedAt: CapturedAt
    var rooms: [Room]
    var structureFile: String?
    var usdzFile: String?
    var files: [FileEntry]
}

enum ManifestBuilderError: Error, Equatable {
    case roomFileMissing(String)
    case duplicatePath(String)
}

enum ManifestBuilder {
    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Build a manifest from on-disk bundle content, hashing the real bytes.
    static func build(
        scanSessionId: UUID,
        captureId: UUID,
        device: CaptureManifest.Device,
        startedAt: Date,
        completedAt: Date,
        rooms: [(roomId: UUID, name: String?, path: String)],
        structureFile: String?,
        fileContents: [String: Data],
        contentTypes: [String: String]
    ) throws -> CaptureManifest {
        var seen = Set<String>()
        var entries: [CaptureManifest.FileEntry] = []
        for (path, data) in fileContents.sorted(by: { $0.key < $1.key }) {
            guard seen.insert(path).inserted else { throw ManifestBuilderError.duplicatePath(path) }
            entries.append(.init(
                path: path,
                byteSize: data.count,
                sha256: sha256Hex(data),
                contentType: contentTypes[path] ?? "application/octet-stream"
            ))
        }
        for room in rooms where fileContents[room.path] == nil {
            throw ManifestBuilderError.roomFileMissing(room.path)
        }
        if let structureFile, fileContents[structureFile] == nil {
            throw ManifestBuilderError.roomFileMissing(structureFile)
        }
        return CaptureManifest(
            scanSessionId: scanSessionId,
            captureId: captureId,
            device: device,
            capturedAt: .init(startedAt: startedAt, completedAt: completedAt),
            rooms: rooms.map { .init(roomId: $0.roomId, name: $0.name, roomplanFile: $0.path) },
            structureFile: structureFile,
            usdzFile: nil,
            files: entries
        )
    }

    static func encode(_ manifest: CaptureManifest) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(manifest)
    }
}
