import Foundation
#if canImport(RoomPlan)
import RoomPlan
#endif

/// Multiroom capture session: several rooms captured one at a time on a single
/// floor, then merged through RoomPlan's structure builder when available.
/// Rooms can be named and deleted locally before upload (spec §6.2).
@MainActor
final class MultiRoomCaptureModel: ObservableObject {
    struct CapturedRoomEntry: Identifiable {
        let id: UUID
        var name: String
        /// RoomPlan Codable JSON for this room, encoded at capture time so the
        /// original artifact is preserved even if the API evolves.
        let roomplanJSON: Data
    }

    @Published private(set) var rooms: [CapturedRoomEntry] = []
    @Published private(set) var structureJSON: Data?
    @Published var structureBuildError: String?

    func addRoom(id: UUID, defaultName: String, roomplanJSON: Data) {
        rooms.append(.init(id: id, name: defaultName, roomplanJSON: roomplanJSON))
        structureJSON = nil // stale after membership changes
    }

    func renameRoom(id: UUID, to name: String) {
        guard let index = rooms.firstIndex(where: { $0.id == id }) else { return }
        rooms[index].name = String(name.prefix(120))
    }

    func deleteRoom(id: UUID) {
        rooms.removeAll { $0.id == id }
        structureJSON = nil
    }

    #if canImport(RoomPlan)
    /// Merge the constituent rooms with RoomPlan's structure builder. Each
    /// CapturedRoom and its transform is retained; the structure result is an
    /// additional artifact, never a replacement (spec §5).
    func buildStructure(from capturedRooms: [CapturedRoom]) async {
        guard capturedRooms.count >= 2 else {
            structureJSON = nil
            return
        }
        do {
            let builder = StructureBuilder(options: [.beautifyObjects])
            let structure = try await builder.capturedStructure(from: capturedRooms)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            structureJSON = try encoder.encode(structure)
            structureBuildError = nil
        } catch {
            // Alignment failure is expected sometimes; the user is asked to
            // identify room connections manually and the import pipeline
            // treats a missing structure as "manual review required".
            structureJSON = nil
            structureBuildError = error.localizedDescription
        }
    }
    #endif
}
