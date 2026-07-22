import Foundation
#if canImport(ZIPFoundation)
import ZIPFoundation
#endif

/// Assembles the on-disk capture bundle (spec §6.3) and zips it for upload.
/// The manifest hashes the exact bytes written to disk; the zip is created
/// only after the manifest is final so the archive is internally consistent.
enum BundlePackager {
    struct PackagedBundle {
        let bundleDirectory: URL
        let zipURL: URL
        let manifest: CaptureManifest
        let zipSHA256: String
        let zipByteSize: Int
    }

    enum PackagingError: Error {
        case zipUnavailable
        case emptyCapture
    }

    static func package(
        scanSessionId: UUID,
        captureId: UUID,
        device: CaptureManifest.Device,
        startedAt: Date,
        completedAt: Date,
        rooms: [MultiRoomCaptureModel.CapturedRoomEntry],
        structureJSON: Data?,
        diagnostics: Data?,
        into workDirectory: URL
    ) throws -> PackagedBundle {
        guard !rooms.isEmpty else { throw PackagingError.emptyCapture }

        let bundleDir = workDirectory.appendingPathComponent("capture-\(captureId.uuidString)")
        let fm = FileManager.default
        try? fm.removeItem(at: bundleDir)
        try fm.createDirectory(
            at: bundleDir.appendingPathComponent("roomplan"),
            withIntermediateDirectories: true
        )

        var fileContents: [String: Data] = [:]
        var contentTypes: [String: String] = [:]
        var roomEntries: [(roomId: UUID, name: String?, path: String)] = []

        for room in rooms {
            let path = "roomplan/room-\(room.id.uuidString.lowercased()).json"
            fileContents[path] = room.roomplanJSON
            contentTypes[path] = "application/json"
            roomEntries.append((roomId: room.id, name: room.name, path: path))
        }
        var structurePath: String?
        if let structureJSON {
            structurePath = "roomplan/structure.json"
            fileContents[structurePath!] = structureJSON
            contentTypes[structurePath!] = "application/json"
        }
        if let diagnostics {
            try fm.createDirectory(
                at: bundleDir.appendingPathComponent("diagnostics"),
                withIntermediateDirectories: true
            )
            fileContents["diagnostics/capture-events.ndjson"] = diagnostics
            contentTypes["diagnostics/capture-events.ndjson"] = "application/x-ndjson"
        }

        for (path, data) in fileContents {
            try data.write(to: bundleDir.appendingPathComponent(path), options: .atomic)
        }

        let manifest = try ManifestBuilder.build(
            scanSessionId: scanSessionId,
            captureId: captureId,
            device: device,
            startedAt: startedAt,
            completedAt: completedAt,
            rooms: roomEntries,
            structureFile: structurePath,
            fileContents: fileContents,
            contentTypes: contentTypes
        )
        let manifestData = try ManifestBuilder.encode(manifest)
        try manifestData.write(
            to: bundleDir.appendingPathComponent("manifest.json"),
            options: .atomic
        )

        #if canImport(ZIPFoundation)
        let zipURL = workDirectory.appendingPathComponent("capture-\(captureId.uuidString).zip")
        try? fm.removeItem(at: zipURL)
        try fm.zipItem(at: bundleDir, to: zipURL, shouldKeepParent: false)
        let zipData = try Data(contentsOf: zipURL)
        return PackagedBundle(
            bundleDirectory: bundleDir,
            zipURL: zipURL,
            manifest: manifest,
            zipSHA256: ManifestBuilder.sha256Hex(zipData),
            zipByteSize: zipData.count
        )
        #else
        throw PackagingError.zipUnavailable
        #endif
    }
}
