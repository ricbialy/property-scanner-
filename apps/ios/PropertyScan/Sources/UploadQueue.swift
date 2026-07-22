import Foundation

/// Offline-first, resumable upload queue. Capture bundles are persisted to the
/// app's Application Support directory before any network activity; uploads are
/// idempotent per captureId, so retries after connectivity loss or app restart
/// are safe. Capture never requires connectivity.
actor UploadQueue {
    struct PendingUpload: Codable, Identifiable, Equatable {
        var id: UUID { captureId }
        var scanSessionId: UUID
        var captureId: UUID
        var bundlePath: String
        var sha256: String
        var byteSize: Int
        var attempts: Int
        var lastError: String?
    }

    private let stateURL: URL
    private(set) var pending: [PendingUpload] = []

    init(directory: URL) {
        stateURL = directory.appendingPathComponent("upload-queue.json")
        pending = Self.load(from: stateURL)
    }

    func enqueue(_ upload: PendingUpload) {
        // Idempotent per captureId: re-enqueueing the same capture is a no-op.
        guard !pending.contains(where: { $0.captureId == upload.captureId }) else { return }
        pending.append(upload)
        persist()
    }

    func markAttemptFailed(captureId: UUID, error: String) {
        guard let index = pending.firstIndex(where: { $0.captureId == captureId }) else { return }
        pending[index].attempts += 1
        pending[index].lastError = error
        persist()
    }

    func markCompleted(captureId: UUID) {
        pending.removeAll { $0.captureId == captureId }
        persist()
    }

    /// Retry backoff in seconds: 2, 4, 8… capped at 5 minutes.
    static func backoff(forAttempt attempt: Int) -> TimeInterval {
        min(pow(2.0, Double(max(attempt, 1))), 300)
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(pending) {
            try? data.write(to: stateURL, options: .atomic)
        }
    }

    private static func load(from url: URL) -> [PendingUpload] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([PendingUpload].self, from: data)) ?? []
    }
}
