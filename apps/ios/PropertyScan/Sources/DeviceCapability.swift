import Foundation
#if canImport(RoomPlan)
import RoomPlan
#endif

/// Runtime capability gating. Scanning is only offered when RoomPlan reports
/// genuine support; everything else gets a precise, honest message.
enum DeviceCapability {
    case supported
    case unsupported(reason: String)

    static func current() -> DeviceCapability {
        #if canImport(RoomPlan)
        if RoomCaptureSession.isSupported {
            return .supported
        }
        return .unsupported(reason: String(
            localized: "This device does not have the LiDAR sensor RoomPlan requires. Scanning needs an iPhone Pro or iPad Pro with LiDAR."
        ))
        #else
        return .unsupported(reason: String(
            localized: "Room capture is not available in this build environment."
        ))
        #endif
    }
}
