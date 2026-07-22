import Foundation

/// Parses `propertyscan://scan?token=<opaque>` deep links. The token is a
/// short-lived, single-use handoff credential — never an API secret — and is
/// exchanged exactly once via `POST /v1/scan-handoff/redeem`.
struct ScanHandoff: Equatable {
    let token: String

    enum HandoffError: LocalizedError {
        case malformedLink

        var errorDescription: String? {
            String(localized: "This scan link is invalid or incomplete. Ask for a fresh link from the dashboard.")
        }
    }

    init(url: URL) throws {
        guard url.scheme == "propertyscan",
              url.host == "scan",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let token = components.queryItems?.first(where: { $0.name == "token" })?.value,
              token.count >= 10, token.count <= 200
        else {
            throw HandoffError.malformedLink
        }
        self.token = token
    }
}
