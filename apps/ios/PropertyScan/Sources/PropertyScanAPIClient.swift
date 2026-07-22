import Foundation

/// Thin async client for the Property Scan API. Authentication uses whatever
/// bearer token the app holds (Clerk session token in production; dev token in
/// development builds). The handoff token is exchanged exactly once and is
/// never stored beyond redemption.
struct PropertyScanAPIClient {
    var baseURL: URL
    var bearerToken: String
    var organizationId: String
    var session: URLSession = .shared

    struct UploadRegistration: Decodable {
        let uploadId: UUID
        let uploadUrl: String?
        let partCount: Int
        let partUploadUrls: [PartURL]
        let objectKey: String

        struct PartURL: Decodable {
            let partNumber: Int
            let uploadUrl: String
        }
    }

    struct UploadStatus: Decodable {
        let uploadId: UUID
        let status: String
        let partCount: Int
        let receivedParts: [Int]
        let missingParts: [Int]
    }

    struct HandoffSession: Decodable {
        let scanSessionId: UUID
        let status: String
    }

    enum APIError: Error {
        case http(status: Int, title: String?)
        case invalidResponse
    }

    // MARK: Requests

    func redeemHandoff(token: String) async throws -> HandoffSession {
        try await post(path: "/v1/scan-handoff/redeem", body: ["token": token], authorized: false)
    }

    func reportStatus(scanSessionId: UUID, from: String, to: String) async throws {
        let _: EmptyReply = try await post(
            path: "/v1/scan-sessions/\(scanSessionId.uuidString.lowercased())/status",
            body: ["from": from, "to": to]
        )
    }

    func registerUpload(
        scanSessionId: UUID,
        captureId: UUID,
        byteSize: Int,
        partCount: Int
    ) async throws -> UploadRegistration {
        try await post(
            path: "/v1/scan-sessions/\(scanSessionId.uuidString.lowercased())/uploads",
            body: [
                "captureId": captureId.uuidString.lowercased(),
                "byteSize": byteSize,
                "contentType": "application/zip",
                "partCount": partCount
            ]
        )
    }

    func uploadStatus(scanSessionId: UUID, uploadId: UUID) async throws -> UploadStatus {
        try await get(
            path: "/v1/scan-sessions/\(scanSessionId.uuidString.lowercased())/uploads/\(uploadId.uuidString.lowercased())"
        )
    }

    /// PUT raw bytes to an upload URL (local part route or presigned URL).
    func putBytes(_ data: Data, to url: URL, contentType: String) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        // Local API routes need auth headers; presigned URLs ignore them.
        applyAuth(&request)
        let (_, response) = try await session.upload(for: request, from: data)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw APIError.http(status: (response as? HTTPURLResponse)?.statusCode ?? -1, title: nil)
        }
    }

    func completeUpload(
        scanSessionId: UUID,
        uploadId: UUID,
        sha256: String,
        byteSize: Int
    ) async throws {
        let _: EmptyReply = try await post(
            path: "/v1/scan-sessions/\(scanSessionId.uuidString.lowercased())/uploads/\(uploadId.uuidString.lowercased())/complete",
            body: ["sha256": sha256, "byteSize": byteSize]
        )
    }

    func completeSession(scanSessionId: UUID) async throws {
        let _: EmptyReply = try await post(
            path: "/v1/scan-sessions/\(scanSessionId.uuidString.lowercased())/complete",
            body: [:]
        )
    }

    // MARK: Plumbing

    private struct EmptyReply: Decodable {
        init(from decoder: Decoder) throws {}
    }

    private func applyAuth(_ request: inout URLRequest) {
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        request.setValue(organizationId, forHTTPHeaderField: "X-Organization-Id")
    }

    private func post<T: Decodable>(
        path: String,
        body: [String: Any],
        authorized: Bool = true
    ) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authorized { applyAuth(&request) }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        return try decode(data: data, response: response)
    }

    private func get<T: Decodable>(path: String) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        applyAuth(&request)
        let (data, response) = try await session.data(for: request)
        return try decode(data: data, response: response)
    }

    private func decode<T: Decodable>(data: Data, response: URLResponse) throws -> T {
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200...299).contains(http.statusCode) else {
            let title = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["title"] as? String
            throw APIError.http(status: http.statusCode, title: title)
        }
        if data.isEmpty, let empty = EmptyReply() as? T {
            return empty
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
