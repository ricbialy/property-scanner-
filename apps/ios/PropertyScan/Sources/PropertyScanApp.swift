import SwiftUI

@main
struct PropertyScanApp: App {
    @StateObject private var appModel = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appModel)
                .onOpenURL { url in
                    appModel.handleDeepLink(url)
                }
        }
    }
}

@MainActor
final class AppModel: ObservableObject {
    @Published var pendingHandoff: ScanHandoff?
    @Published var deepLinkError: String?

    func handleDeepLink(_ url: URL) {
        do {
            pendingHandoff = try ScanHandoff(url: url)
            deepLinkError = nil
        } catch {
            pendingHandoff = nil
            deepLinkError = error.localizedDescription
        }
    }
}
