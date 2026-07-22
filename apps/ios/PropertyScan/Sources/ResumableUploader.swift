import CryptoKit
import Foundation

/// Chunked, resumable bundle upload. The server is the source of truth for
/// which parts it holds, so resuming after connectivity loss or app restart
/// asks the server first and uploads only the missing parts. Registration and
/// parts are idempotent server-side, making every step safe to retry.
struct ResumableUploader {
    /// 8 MiB chunks: large enough to keep request count low for typical
    /// bundles, small enough to retry cheaply on flaky jobsite connections.
    static let defaultPartSizeBytes = 8 * 1024 * 1024

    let api: PropertyScanAPIClient
    var partSizeBytes: Int = ResumableUploader.defaultPartSizeBytes

    static func partCount(forByteSize byteSize: Int, partSizeBytes: Int) -> Int {
        max(1, Int((Int64(byteSize) + Int64(partSizeBytes) - 1) / Int64(partSizeBytes)))
    }

    static func byteRange(forPart partNumber: Int, byteSize: Int, partSizeBytes: Int) -> Range<Int> {
        let start = (partNumber - 1) * partSizeBytes
        return start..<min(start + partSizeBytes, byteSize)
    }

    /// Upload (or resume uploading) a packaged bundle. Progress is reported as
    /// completed parts over total parts.
    func upload(
        bundle: BundlePackager.PackagedBundle,
        scanSessionId: UUID,
        onProgress: ((Int, Int) -> Void)? = nil
    ) async throws {
        let data = try Data(contentsOf: bundle.zipURL)
        let totalParts = Self.partCount(forByteSize: data.count, partSizeBytes: partSizeBytes)

        let registration = try await api.registerUpload(
            scanSessionId: scanSessionId,
            captureId: bundle.manifest.captureId,
            byteSize: data.count,
            partCount: totalParts
        )

        if totalParts == 1, let single = registration.uploadUrl, let url = URL(string: single) {
            try await api.putBytes(data, to: url, contentType: "application/zip")
        } else {
            let urlByPart = Dictionary(
                uniqueKeysWithValues: registration.partUploadUrls.map { ($0.partNumber, $0.uploadUrl) }
            )
            // Ask the server what it already has — this is the resume path.
            let status = try await api.uploadStatus(
                scanSessionId: scanSessionId,
                uploadId: registration.uploadId
            )
            var completed = status.receivedParts.count
            onProgress?(completed, totalParts)
            for partNumber in status.missingParts {
                guard let raw = urlByPart[partNumber], let url = URL(string: raw) else {
                    throw PropertyScanAPIClient.APIError.invalidResponse
                }
                let range = Self.byteRange(
                    forPart: partNumber, byteSize: data.count, partSizeBytes: partSizeBytes
                )
                try await api.putBytes(
                    data.subdata(in: range), to: url, contentType: "application/octet-stream"
                )
                completed += 1
                onProgress?(completed, totalParts)
            }
        }

        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        try await api.completeUpload(
            scanSessionId: scanSessionId,
            uploadId: registration.uploadId,
            sha256: digest,
            byteSize: data.count
        )
    }
}
