import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                switch DeviceCapability.current() {
                case .supported:
                    supportedContent
                case .unsupported(let reason):
                    ContentUnavailableView {
                        Label("Scanning unavailable", systemImage: "camera.metering.unknown")
                    } description: {
                        Text(reason)
                    }
                }
                if let error = appModel.deepLinkError {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            .padding()
            .navigationTitle("Property Scan")
        }
    }

    @ViewBuilder
    private var supportedContent: some View {
        if let handoff = appModel.pendingHandoff {
            VStack(spacing: 12) {
                Text("Scan assignment received")
                    .font(.headline)
                Text("Token \(String(handoff.token.prefix(12)))… will be redeemed to load the scan session. Begin near a doorway and move slowly along walls and openings.")
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                // Capture flow entry point (RoomCaptureContainer) is wired in
                // the Phase 2 continuation once session redemption lands.
            }
        } else {
            ContentUnavailableView {
                Label("No scan assigned", systemImage: "qrcode.viewfinder")
            } description: {
                Text("Open a scan link from the Property Scan dashboard, or scan its QR code, to begin capture.")
            }
        }
    }
}
