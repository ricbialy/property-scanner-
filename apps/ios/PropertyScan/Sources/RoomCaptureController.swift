import Foundation
import SwiftUI
#if canImport(RoomPlan)
import RoomPlan

/// Guided single-room capture using RoomCaptureView/RoomCaptureSession.
/// Multiroom structure building (Phase 2 continuation) will retain each
/// constituent CapturedRoom plus its transform before merging.
struct RoomCaptureContainer: UIViewRepresentable {
    @ObservedObject var controller: RoomCaptureController

    func makeUIView(context: Context) -> RoomCaptureView {
        let view = RoomCaptureView(frame: .zero)
        view.delegate = controller
        controller.attach(view: view)
        return view
    }

    func updateUIView(_ uiView: RoomCaptureView, context: Context) {}
}

@MainActor
final class RoomCaptureController: NSObject, ObservableObject, RoomCaptureViewDelegate {
    @Published private(set) var capturedRooms: [CapturedRoom] = []
    @Published private(set) var isCapturing = false
    @Published var captureError: String?

    private weak var captureView: RoomCaptureView?

    override init() {
        super.init()
    }

    // RoomCaptureViewDelegate inherits NSCoding; the controller is never
    // archived, so these are inert conformance stubs.
    nonisolated func encode(with coder: NSCoder) {}

    nonisolated required init?(coder: NSCoder) {
        nil
    }

    func attach(view: RoomCaptureView) {
        captureView = view
    }

    func startCapture() {
        guard case .supported = DeviceCapability.current() else { return }
        var configuration = RoomCaptureSession.Configuration()
        configuration.isCoachingEnabled = true
        captureView?.captureSession.run(configuration: configuration)
        isCapturing = true
    }

    func stopCapture() {
        captureView?.captureSession.stop()
        isCapturing = false
    }

    // MARK: RoomCaptureViewDelegate

    nonisolated func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        true
    }

    nonisolated func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        Task { @MainActor in
            if let error {
                self.captureError = error.localizedDescription
                return
            }
            self.capturedRooms.append(processedResult)
        }
    }

    /// Export RoomPlan's Codable representation for the capture bundle.
    func exportRoomJSON(_ room: CapturedRoom) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(room)
    }
}
#endif
