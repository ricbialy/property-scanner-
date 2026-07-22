import Foundation

/// Local capture lifecycle mirroring the server state machine (spec §6.1).
/// Transitions are validated; illegal jumps are programming errors surfaced
/// in tests rather than silently absorbed.
enum ScanSessionState: String, Codable, CaseIterable {
    case draft
    case capturing
    case localReview = "local_review"
    case paused
    case queuedUpload = "queued_upload"
    case uploading
    case processing
    case needsReview = "needs_review"
    case failed
    case completed

    var legalNextStates: Set<ScanSessionState> {
        switch self {
        case .draft: return [.capturing]
        case .capturing: return [.localReview, .paused]
        case .paused: return [.capturing]
        case .localReview: return [.queuedUpload]
        case .queuedUpload: return [.uploading]
        case .uploading: return [.processing, .queuedUpload]
        case .processing: return [.needsReview, .failed]
        case .needsReview: return [.completed]
        case .failed, .completed: return []
        }
    }

    func canTransition(to next: ScanSessionState) -> Bool {
        legalNextStates.contains(next)
    }
}

/// Persisted capture record so state survives app termination mid-jobsite.
struct LocalScanSession: Codable {
    var scanSessionId: UUID
    var captureId: UUID
    var state: ScanSessionState
    var roomNames: [UUID: String]
    var createdAt: Date

    mutating func transition(to next: ScanSessionState) throws {
        guard state.canTransition(to: next) else {
            throw TransitionError.illegal(from: state, to: next)
        }
        state = next
    }

    enum TransitionError: Error, Equatable {
        case illegal(from: ScanSessionState, to: ScanSessionState)
    }
}
