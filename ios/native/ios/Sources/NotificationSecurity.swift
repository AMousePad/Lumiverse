import CryptoKit
import Foundation
import Security

/// Shared by the host and its notification service extension. All cryptography
/// uses Apple's CryptoKit and all networking uses Foundation's URLSession.
enum NotificationSecurity {
    static var relayURL: URL { URL(string: Bundle.main.object(forInfoDictionaryKey: "LumiverseAPNsRelayURL") as? String
        ?? "https://apn-relay.lumiverse.chat")! }
    enum Failure: LocalizedError {
        case storage, network, verification, invalid
        var errorDescription: String? {
            switch self {
            case .storage: return "Could not securely store notification keys. Check the IPA's shared Keychain entitlement."
            case .network: return "The notification relay is unavailable. Check the network and try again."
            case .verification: return "Notification device verification timed out. Keep Lumiverse open and try again."
            case .invalid: return "Invalid notification enrollment."
            }
        }
    }
    static func browserOrigin(_ url: URL?) -> String? {
        guard let url = url, var parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              ["http", "https"].contains(parts.scheme ?? ""), parts.host != nil else { return nil }
        parts.path = ""; parts.query = nil; parts.fragment = nil; parts.user = nil; parts.password = nil
        if parts.port == (parts.scheme == "https" ? 443 : 80) { parts.port = nil }
        return parts.string
    }
    private static func query(_ account: String) throws -> [String: Any] {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "LumiverseNotificationKeychainGroup") as? String,
              !group.isEmpty, !group.contains("$(") else { throw Failure.storage }
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "chat.lumiverse.notifications",
            kSecAttrAccount as String: account, kSecAttrAccessGroup as String: group]
    }
    static func read(_ account: String) throws -> Data? {
        var query = try query(account); query[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw Failure.storage }
        return data
    }
    static func save(_ account: String, _ data: Data) throws {
        let query = try query(account)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query; item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw Failure.storage }
        } else if status != errSecSuccess { throw Failure.storage }
    }
    static func remove(_ account: String) { if let query = try? query(account) { SecItemDelete(query as CFDictionary) } }
    static func digest(_ value: Data) -> String { SHA256.hash(data: value).map { String(format: "%02x", $0) }.joined() }
    static func random() -> String {
        let key = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
        return key.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    static func encryption(for origin: String) throws -> [String: String] {
        let account = "origin-key:" + digest(Data(origin.utf8))
        let data: Data
        if let saved = try read(account) { data = saved }
        else { data = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }; try save(account, data) }
        let id = String(digest(data).prefix(32))
        try save("key:" + id, data)
        try save("key-origin:" + id, Data(origin.utf8))
        return ["key": data.base64EncodedString(), "keyId": id]
    }
    static func decrypt(_ envelope: [String: Any], bundleId: String, environment: String) throws -> [String: Any] {
        guard let id = envelope["keyId"] as? String,
              id.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
              let key = try read("key:" + id) else { throw Failure.invalid }
        let result = try openEnvelope(envelope, key: key, bundleId: bundleId, environment: environment)
        guard let originData = try read("key-origin:" + id), let expected = String(data: originData, encoding: .utf8),
              result["serverOrigin"] as? String == expected else { throw Failure.invalid }
        return result
    }
    static func openEnvelope(_ envelope: [String: Any], key: Data, bundleId: String, environment: String) throws -> [String: Any] {
        guard envelope["version"] as? Int == 1, let id = envelope["keyId"] as? String,
              id.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
              key.count == 32, String(digest(key).prefix(32)) == id,
              let nonce = envelope["nonce"] as? String, let nonceBytes = Data(base64Encoded: nonce), nonceBytes.count == 12,
              let ciphertext = envelope["ciphertext"] as? String, let bytes = Data(base64Encoded: ciphertext), bytes.count <= 2700,
              let tag = envelope["tag"] as? String, let tagBytes = Data(base64Encoded: tag), tagBytes.count == 16 else { throw Failure.invalid }
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonceBytes), ciphertext: bytes, tag: tagBytes)
        let clear = try AES.GCM.open(box, using: SymmetricKey(data: key),
            authenticating: Data("lumiverse-apns:v1:\(bundleId):\(environment):\(id)".utf8))
        guard let result = try JSONSerialization.jsonObject(with: clear) as? [String: Any] else { throw Failure.invalid }
        return result
    }
    struct RelayRegistration: Codable {
        let deviceToken: String
        let deliveryCredential: String
        let managementCredential: String
        let expiresAt: Double
    }
    struct Pending: Codable { let origin: String; let expiresAt: Double }
    static func relayAccount(_ origin: String) -> String { "relay:" + digest(Data(origin.utf8)) }
    static func hasRelayRegistration(origin: String?) -> Bool {
        guard let origin = origin, let data = try? read(relayAccount(origin)),
              let saved = try? JSONDecoder().decode(RelayRegistration.self, from: data) else { return false }
        return saved.expiresAt > Date().timeIntervalSince1970
    }

    static func enroll(token: String, bundleId: String, environment: String, origin: String) async throws -> RelayRegistration {
        if let data = try read(relayAccount(origin)), let saved = try? JSONDecoder().decode(RelayRegistration.self, from: data),
           saved.deviceToken == token, saved.expiresAt > Date().timeIntervalSince1970 + 86400 {
            let (_, status) = try await request("/v1/registration", credential: saved.managementCredential)
            if status == 200 { return saved }
            guard status == 401 else { throw Failure.network }
        }
        let id = random()
        try save("pending:" + id, JSONEncoder().encode(Pending(origin: origin, expiresAt: Date().timeIntervalSince1970 + 120)))
        defer { remove("pending:" + id) }
        let (begin, status) = try await request("/v1/enrollments", body: ["id": id, "deviceToken": token,
            "bundleId": bundleId, "environment": environment, "serverOrigin": origin])
        guard status == 202, let poll = begin["pollToken"] as? String else { throw Failure.network }
        for _ in 0..<50 {
            try await Task.sleep(nanoseconds: 1_000_000_000)
            let (result, status) = try await request("/v1/enrollments/" + id, credential: poll)
            if status == 202 { continue }
            guard status == 200, let delivery = result["deliveryCredential"] as? String,
                  let management = result["managementCredential"] as? String, let expiresAt = result["expiresAt"] as? Double,
                  validCredential(delivery), validCredential(management) else { throw Failure.verification }
            let registration = RelayRegistration(deviceToken: token, deliveryCredential: delivery,
                managementCredential: management, expiresAt: expiresAt)
            try save(relayAccount(origin), JSONEncoder().encode(registration))
            return registration
        }
        throw Failure.verification
    }
    static func validCredential(_ value: String) -> Bool { value.range(of: "^lvr_[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil }
    /// Never acknowledge an unsolicited challenge or a request for another server.
    static func confirm(_ challenge: [String: Any]) async {
        guard let id = challenge["id"] as? String, id.range(of: "^[A-Za-z0-9_-]{32,64}$", options: .regularExpression) != nil,
              let proof = challenge["challenge"] as? String, proof.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              let data = try? read("pending:" + id), let pending = try? JSONDecoder().decode(Pending.self, from: data),
              pending.expiresAt > Date().timeIntervalSince1970, pending.origin == challenge["serverOrigin"] as? String else { return }
        _ = try? await request("/v1/enrollments/" + id + "/confirm", body: ["challenge": proof])
    }
    static func activityCredential(token: String, origin: String) async throws -> String {
        guard let data = try read(relayAccount(origin)), let saved = try? JSONDecoder().decode(RelayRegistration.self, from: data),
              saved.expiresAt > Date().timeIntervalSince1970 else { throw Failure.verification }
        let (result, status) = try await request("/v1/activities", body: ["deviceToken": token], credential: saved.managementCredential)
        guard (200...201).contains(status), let credential = result["deliveryCredential"] as? String,
              validCredential(credential) else { throw Failure.network }
        return credential
    }
    static func request(_ path: String, body: [String: Any]? = nil, credential: String? = nil) async throws -> ([String: Any], Int) {
        guard relayURL.scheme == "https", relayURL.user == nil, relayURL.password == nil,
              let url = URL(string: path, relativeTo: relayURL)?.absoluteURL, url.host == relayURL.host else { throw Failure.invalid }
        var request = URLRequest(url: url)
        request.httpMethod = body == nil ? "GET" : "POST"
        if let body = body { request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let credential = credential { request.setValue("Bearer " + credential, forHTTPHeaderField: "Authorization") }
        let (data, status) = try await NotificationRelayRequest().perform(request)
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure.network }
        return (value, status)
    }
}

/// Bounded replies, default TLS verification, no cookies/cache/credentials/redirects.
private final class NotificationRelayRequest: NSObject, URLSessionDataDelegate {
    private var continuation: CheckedContinuation<(Data, Int), Error>?
    private var session: URLSession?
    private var bytes = Data()
    private var status = 0
    func perform(_ request: URLRequest) async throws -> (Data, Int) {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let config = URLSessionConfiguration.ephemeral
            config.httpShouldSetCookies = false; config.httpCookieStorage = nil; config.urlCache = nil; config.urlCredentialStorage = nil
            config.timeoutIntervalForRequest = 12; config.timeoutIntervalForResource = 15
            session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
            session?.dataTask(with: request).resume()
        }
    }
    private func finish(_ error: Error? = nil) {
        let callback = continuation; continuation = nil
        session?.invalidateAndCancel(); session = nil
        if let error = error { callback?.resume(throwing: error) } else { callback?.resume(returning: (bytes, status)) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil); finish(NotificationSecurity.Failure.network) }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse, response.mimeType == "application/json", response.expectedContentLength <= 8192 else {
            completionHandler(.cancel); finish(NotificationSecurity.Failure.network); return
        }
        status = response.statusCode; completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard bytes.count + data.count <= 8192 else { finish(NotificationSecurity.Failure.network); return }; bytes.append(data)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) { finish(error) }
}
