import ActivityKit
import Security
import UIKit
import WebKit

@available(iOS 16.1, *)
@MainActor
final class IOSLiveActivities: NSObject, URLSessionTaskDelegate {
    static let shared = IOSLiveActivities()
    private struct Enrollment: Codable {
        let registrationId: String
        let credential: String
        let expiresAt: Double
        let accountId: String
        let serverOrigin: String
        let delivery: String?
        var attributes: GenerationActivityAttributes
        let state: GenerationActivityAttributes.ContentState
        var activityId: String?
        var pushToken: String?
        var ended = false
        var revoked = false
    }
    private var records: [String: Enrollment] = [:]
    private var tokenTasks: [String: Task<Void, Never>] = [:]
    private var stateTasks: [String: Task<Void, Never>] = [:]
    private var uploadTasks: [String: Task<Void, Never>] = [:]
    private var uploadAttempts: [String: UUID] = [:]
    private let handoff = LiveActivityHandoff()
    private var starting = Set<String>()
    private weak var webview: WKWebView?
    private var accountId: String?
    private var configuredOrigin: String?
    private var enabled = false
    private var pendingTap: String?
    private var keychain: [String: Any] { [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "chat.lumiverse.live-activities", kSecAttrAccount as String: "enrollments"] }
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForRequest = 12
        config.timeoutIntervalForResource = 15
        return URLSession(configuration: config, delegate: self, delegateQueue: .main)
    }()

    override private init() {
        super.init()
        var query = keychain
        query[kSecReturnData as String] = true
        var result: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data,
           let saved = try? JSONDecoder().decode([String: Enrollment].self, from: data) { records = saved }
    }
    private func save() throws {
        let data = try JSONEncoder().encode(records)
        let update = [kSecValueData as String: data]
        let status = SecItemUpdate(keychain as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var item = keychain
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw Failure.storage }
        } else if status != errSecSuccess { throw Failure.storage }
    }
    enum Failure: LocalizedError {
        case unavailable, invalid, storage, action
        var errorDescription: String? {
            switch self {
            case .unavailable: return "Live Activities are unavailable or disabled."
            case .invalid: return "Invalid Live Activity enrollment."
            case .storage: return "Could not securely save this Live Activity."
            case .action: return "Could not stop the response. Check your connection and try again."
            }
        }
    }
    private var supported: Bool {
        Bundle.main.object(forInfoDictionaryKey: "NSSupportsLiveActivities") as? Bool == true
            && Bundle.main.object(forInfoDictionaryKey: "LumiversePushEnabled") as? Bool == true
    }
    func attach(_ webview: WKWebView) {
        self.webview = webview
        GenerationActivityAvatar.prune()
        restoreActivities()
        retryPending()
    }
    // UIKit recovery runs even if WebKit misses a visibility event or its old
    // registration request was suspended. Retry uploads immediately on return.
    func resume() {
        for task in uploadTasks.values { task.cancel() }
        uploadTasks.removeAll()
        uploadAttempts.removeAll()
        restoreActivities()
        retryPending()
    }
    private func restoreActivities() {
        let activities = Activity<GenerationActivityAttributes>.activities
        let activeIds = Set(activities.map { $0.id })
        for (id, record) in records where !record.ended && !starting.contains(id) && !activeIds.contains(record.activityId ?? "") {
            records[id]?.ended = true
            tokenTasks.removeValue(forKey: id)?.cancel()
            stateTasks.removeValue(forKey: id)?.cancel()
        }
        for activity in Activity<GenerationActivityAttributes>.activities {
            if let record = records.values.first(where: { $0.activityId == activity.id }) {
                if record.ended { continue }
                if activity.activityState == .ended || activity.activityState == .dismissed {
                    records[record.registrationId]?.ended = true
                    tokenTasks.removeValue(forKey: record.registrationId)?.cancel()
                    stateTasks.removeValue(forKey: record.registrationId)?.cancel()
                } else { observe(activity, registrationId: record.registrationId) }
            } else {
                Task { await activity.end(using: nil, dismissalPolicy: .immediate) }
            }
        }
        try? save()
    }
    func status() -> [String: Any] {
        let current = records.values.filter { $0.accountId == accountId && NativeBridge.origin(URL(string: $0.serverOrigin)) == configuredOrigin
            // An abandoned start has no ActivityKit ID. It must remain retryable,
            // unlike an activity that was actually shown and then dismissed.
            && ($0.activityId != nil || !$0.ended) }
        return ["available": supported && ActivityAuthorizationInfo().areActivitiesEnabled,
            "relayEnrolled": NotificationSecurity.hasRelayRegistration(origin: NotificationSecurity.browserOrigin(webview?.url)),
            "generationIds": current.filter { !$0.ended }.map { $0.attributes.generationId },
            "suppressedGenerationIds": current.filter { $0.ended }.map { $0.attributes.generationId },
            "activities": current.filter { !$0.ended }.map { record -> [String: Any] in
                let activity = Activity<GenerationActivityAttributes>.activities.first { $0.id == record.activityId }
                var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
                GenerationActivityAvatar.accent(record.attributes.avatarKey).getRed(&red, green: &green, blue: &blue, alpha: &alpha)
                return ["generationId": record.attributes.generationId,
                    "phase": activity?.contentState.phase ?? record.state.phase,
                    "avatarAccent": [red, green, blue].map { Int(($0 * 255).rounded()) },
                    "hasAvatar": GenerationActivityAvatar.file(record.attributes.avatarKey).map { FileManager.default.fileExists(atPath: $0.path) } ?? false]
            },
            "deviceId": IOSNotifications.shared.installation["deviceId"]!,
            "bundleId": IOSNotifications.shared.installation["bundleId"]!,
            "environment": IOSNotifications.shared.installation["environment"]!]
    }
    func configure(accountId: String?, enabled: Bool) async {
        let origin = NativeBridge.origin(webview?.url)
        self.accountId = accountId
        configuredOrigin = origin
        self.enabled = enabled
        restoreActivities()
        for (id, record) in records {
            if !enabled || accountId != record.accountId || origin != NativeBridge.origin(URL(string: record.serverOrigin))
                || record.expiresAt <= Date().timeIntervalSince1970 * 1000 {
                await finish(id, state: nil, immediate: true)
            }
        }
        retryPending()
        openPendingTap()
    }
    func selectedOriginChanged() async {
        guard configuredOrigin != nil, NativeBridge.origin(webview?.url) != configuredOrigin else { return }
        await configure(accountId: nil, enabled: false)
    }
    func start(_ payload: [String: Any]) async throws -> [String: Any] {
        guard enabled, supported, ActivityAuthorizationInfo().areActivitiesEnabled,
              UIApplication.shared.applicationState == .active else { throw Failure.unavailable }
        var input = payload
        input["ended"] = false
        input["revoked"] = false
        input.removeValue(forKey: "activityId")
        input.removeValue(forKey: "pushToken")
        let data = try JSONSerialization.data(withJSONObject: input)
        guard data.count <= 4096 else { throw Failure.invalid }
        var record = try JSONDecoder().decode(Enrollment.self, from: data)
        record.attributes.avatarKey = nil // Shared-container references are issued only by native code.
        let attrs = record.attributes
        guard let view = webview, let origin = NativeBridge.origin(view.url), origin == configuredOrigin,
              NativeBridge.origin(URL(string: record.serverOrigin)) == origin, record.serverOrigin == attrs.serverOrigin,
              record.accountId == accountId, attrs.accountId == accountId, Self.identifier(record.registrationId),
              Self.identifier(attrs.generationId), Self.identifier(attrs.chatId), record.credential.count == 43,
              record.credential.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil,
              attrs.characterName.utf8.count <= 512, record.expiresAt > Date().timeIntervalSince1970 * 1000,
              record.expiresAt <= Date().timeIntervalSince1970 * 1000 + 8 * 3600 * 1000 + 60_000 else { throw Failure.invalid }
        if records.values.contains(where: { $0.accountId == record.accountId && $0.serverOrigin == record.serverOrigin
            && $0.attributes.generationId == attrs.generationId && ($0.activityId != nil || !$0.ended) }) { return ["started": false] }
        starting.insert(record.registrationId)
        defer { starting.remove(record.registrationId) }
        // Persist the revocation credential before asking ActivityKit for a token.
        records[record.registrationId] = record
        do {
            try save()
            guard !record.state.terminal else { await finish(record.registrationId, state: record.state, immediate: true); return ["started": false] }
            guard protectHandoff(record.registrationId) else { throw Failure.unavailable }
            if let key = await fetchAvatar(record) {
                records[record.registrationId]?.attributes.avatarKey = key
            }
            // Downloading yields the actor: logout, a server switch, or a lock
            // during prefetch must not create a new activity afterwards.
            guard enabled, accountId == record.accountId, NativeServerOrigin.matches(record.serverOrigin, configuredOrigin),
                  records[record.registrationId]?.ended == false,
                  UIApplication.shared.applicationState == .active else { throw Failure.unavailable }
            let activityAttributes = records[record.registrationId]!.attributes
            let activity: Activity<GenerationActivityAttributes>
            if #available(iOS 16.2, *) {
                // Until the server has the token, the initial phase is only a
                // provisional snapshot. Don't display it as current for minutes
                // if iOS denies/expires the registration handoff.
                activity = try Activity.request(attributes: activityAttributes, content: ActivityContent(state: record.state, staleDate: .now.addingTimeInterval(30)), pushType: .token)
            } else {
                activity = try Activity.request(attributes: activityAttributes, contentState: record.state, pushType: .token)
            }
            records[record.registrationId]?.activityId = activity.id
            do { try save() } catch { await activity.end(using: nil, dismissalPolicy: .immediate); throw error }
            observe(activity, registrationId: record.registrationId)
            return ["started": true]
        } catch {
            // Failed requests (including backgrounding during avatar prefetch)
            // aren't user dismissals. Don't suppress this generation forever.
            records[record.registrationId]?.activityId = nil
            await finish(record.registrationId, state: nil, immediate: true)
            throw error
        }
    }
    private func fetchAvatar(_ record: Enrollment) async -> String? {
        guard GenerationActivityAvatar.directory != nil,
              let url = URL(string: record.serverOrigin + "/api/ios-activities/v1/registrations/" + record.registrationId + "/avatar") else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 2
        request.setValue("Bearer " + record.credential, forHTTPHeaderField: "Authorization")
        do {
            let (bytes, response) = try await session.bytes(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  http.mimeType == "image/jpeg", http.expectedContentLength <= 256 * 1024 else { return nil }
            var data = Data()
            for try await byte in bytes {
                guard data.count < 256 * 1024 else { return nil }
                data.append(byte)
            }
            return try GenerationActivityAvatar.store(data)
        } catch { return nil } // A missing/offline avatar never prevents generation status.
    }
    func reconcile(_ snapshots: [[String: Any]]) async {
        for snapshot in snapshots {
            guard let generationId = snapshot["generationId"] as? String,
                  let data = try? JSONSerialization.data(withJSONObject: snapshot["state"] ?? [:]),
                  let state = try? JSONDecoder().decode(GenerationActivityAttributes.ContentState.self, from: data) else { continue }
            for (id, record) in records where record.accountId == accountId && NativeBridge.origin(URL(string: record.serverOrigin)) == configuredOrigin
                && record.attributes.generationId == generationId && !record.ended {
                await apply(state, to: id)
            }
        }
        openPendingTap()
    }
    private func apply(_ state: GenerationActivityAttributes.ContentState, to id: String, refreshStaleDate: Bool = false) async {
        guard let record = records[id], !record.ended else { return }
        if state.terminal {
            // WebSocket reconciliation can arrive before the ActivityKit push.
            // Leave a background activity alive for its alerting completion
            // update; the backend follows that update with a silent end.
            if (state.phase == "completed" || state.phase == "error"), record.pushToken != nil,
               UIApplication.shared.applicationState != .active { return }
            await finish(id, state: state, immediate: false)
            return
        }
        guard let activity = Activity<GenerationActivityAttributes>.activities.first(where: { $0.id == record.activityId }) else { return }
        let current = activity.contentState
        guard !current.terminal, refreshStaleDate || current.phase != state.phase else { return }
        // A foreground snapshot may have been captured just before a newer push.
        let phases = ["assembling", "council", "waiting", "reasoning", "streaming"]
        if let before = phases.firstIndex(of: current.phase), let after = phases.firstIndex(of: state.phase), after < before { return }
        if #available(iOS 16.2, *) {
            await activity.update(ActivityContent(state: state, staleDate: .now.addingTimeInterval(300)))
        } else { await activity.update(using: state) }
    }
    private func observe(_ activity: Activity<GenerationActivityAttributes>, registrationId id: String) {
        // Sample the current token on every recovery, even if the async token
        // observer was already installed before suspension.
        if let token = activity.pushToken {
            records[id]?.pushToken = token.map { String(format: "%02x", $0) }.joined()
            try? save()
        }
        upload(id)
        guard tokenTasks[id] == nil else { return }
        tokenTasks[id] = Task { [weak self] in
            for await token in activity.pushTokenUpdates {
                guard let self = self, !Task.isCancelled, self.records[id]?.ended == false else { break }
                self.records[id]?.pushToken = token.map { String(format: "%02x", $0) }.joined()
                try? self.save()
                self.upload(id)
            }
        }
        stateTasks[id] = Task { [weak self] in
            for await state in activity.activityStateUpdates {
                guard let self = self, !Task.isCancelled else { break }
                if state == .dismissed || state == .ended {
                    self.records[id]?.ended = true
                    try? self.save()
                    self.tokenTasks.removeValue(forKey: id)?.cancel()
                    self.upload(id)
                    break
                }
            }
        }
    }
    func stopGeneration(_ generationId: String) async throws {
        guard let record = records.values.first(where: { $0.attributes.generationId == generationId && !$0.ended && !$0.revoked }),
              let activity = Activity<GenerationActivityAttributes>.activities.first(where: { $0.id == record.activityId }),
              !activity.contentState.terminal,
              let url = URL(string: record.serverOrigin + "/api/ios-activities/v1/registrations/" + record.registrationId + "/stop") else { throw Failure.unavailable }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 8
        request.setValue("Bearer " + record.credential, forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), data.count <= 4096,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let stateData = try? JSONSerialization.data(withJSONObject: object["state"] ?? [:]),
              let state = try? JSONDecoder().decode(GenerationActivityAttributes.ContentState.self, from: stateData) else { throw Failure.action }
        if state.terminal { await finish(record.registrationId, state: state, immediate: false, linger: 15) }
        else { await apply(state, to: record.registrationId) }
    }
    func hideGeneration(_ generationId: String) async {
        guard let record = records.values.first(where: { $0.attributes.generationId == generationId && !$0.ended }) else { return }
        await finish(record.registrationId, state: nil, immediate: true)
    }
    private func finish(_ id: String, state: GenerationActivityAttributes.ContentState?, immediate: Bool, linger: TimeInterval = 120) async {
        guard let record = records[id] else { return }
        handoff.end(id)
        records[id]?.ended = true
        try? save()
        tokenTasks.removeValue(forKey: id)?.cancel()
        stateTasks.removeValue(forKey: id)?.cancel()
        if let activity = Activity<GenerationActivityAttributes>.activities.first(where: { $0.id == record.activityId }) {
            await activity.end(using: state, dismissalPolicy: immediate ? .immediate : .after(.now.addingTimeInterval(linger)))
        }
        if immediate { GenerationActivityAvatar.remove(record.attributes.avatarKey) }
        upload(id)
    }
    func retryPending() {
        for (id, record) in records {
            if record.expiresAt <= Date().timeIntervalSince1970 * 1000 {
                handoff.end(id)
                records.removeValue(forKey: id)
            } else if record.ended || record.pushToken != nil { upload(id) }
        }
        try? save()
    }
    @discardableResult
    private func protectHandoff(_ id: String) -> Bool {
        handoff.begin(id) { [weak self] in
            guard let self = self else { return }
            self.uploadTasks[id]?.cancel()
            self.tokenTasks.removeValue(forKey: id)?.cancel()
            // A card with no confirmed server delivery route must not remain
            // on Preparing indefinitely. Keep revocation retryable and let the
            // foreground snapshot start a replacement, rather than suppress it.
            Task { @MainActor in
                await self.finish(id, state: nil, immediate: true)
                self.records[id]?.activityId = nil
                try? self.save()
            }
        }
    }
    private func upload(_ id: String) {
        guard uploadTasks[id] == nil, let record = records[id], !record.revoked, record.ended || record.pushToken != nil else { return }
        // Acquire synchronously, before scheduling network work, and reuse the
        // assertion already held since Activity.request when this is a new card.
        protectHandoff(id)
        let attempt = UUID()
        uploadAttempts[id] = attempt
        uploadTasks[id] = Task { [weak self] in
            defer {
                if self?.uploadAttempts[id] == attempt {
                    self?.handoff.end(id)
                    self?.uploadTasks[id] = nil
                    self?.uploadAttempts[id] = nil
                }
            }
            var delay: UInt64 = 2
            while !Task.isCancelled, let self = self, let current = self.records[id], !current.revoked {
                guard current.expiresAt > Date().timeIntervalSince1970 * 1000 else { break }
                guard let url = URL(string: current.serverOrigin + "/api/ios-activities/v1/registrations/" + id) else { break }
                var request = URLRequest(url: url)
                request.httpMethod = current.ended ? "DELETE" : "PUT"
                request.setValue("Bearer " + current.credential, forHTTPHeaderField: "Authorization")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                if !current.ended {
                    guard let token = current.pushToken, let activityId = current.activityId else { break }
                    var body: [String: String] = ["pushToken": token, "activityId": activityId]
                    if current.delivery == "relay" {
                        do { body["relayCredential"] = try await NotificationSecurity.activityCredential(token: token, origin: current.serverOrigin) }
                        catch {
                            do { try await Task.sleep(nanoseconds: delay * 1_000_000_000) } catch { break }
                            delay = min(delay * 2, 60); continue
                        }
                    }
                    request.httpBody = try? JSONSerialization.data(withJSONObject: body)
                }
                do {
                    let (data, response) = try await self.session.data(for: request)
                    guard !Task.isCancelled, let http = response as? HTTPURLResponse else { break }
                    if http.statusCode == 401 || http.statusCode == 404 {
                        self.records[id]?.revoked = true
                        await self.finish(id, state: nil, immediate: true)
                        break
                    }
                    if (200..<300).contains(http.statusCode) {
                        if current.ended { self.records[id]?.revoked = true; try? self.save(); break }
                        if data.count < 4096, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                           let stateData = try? JSONSerialization.data(withJSONObject: object["state"] ?? [:]),
                           let state = try? JSONDecoder().decode(GenerationActivityAttributes.ContentState.self, from: stateData) {
                            await self.apply(state, to: id, refreshStaleDate: true)
                            if state.terminal { continue }
                        }
                        // A rotation that arrived while the request was in flight must follow it.
                        if self.records[id]?.pushToken == current.pushToken && self.records[id]?.ended == false { break }
                        continue
                    }
                } catch { if Task.isCancelled { break } }
                do { try await Task.sleep(nanoseconds: delay * 1_000_000_000) } catch { break }
                delay = min(delay * 2, 60)
            }
        }
    }
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }

    func open(_ raw: String) {
        guard let url = URLComponents(string: raw), url.scheme == "lumiverse", url.host == "activity",
              url.query == nil, url.fragment == nil, url.user == nil, url.password == nil, url.port == nil else { return }
        let id = String(url.path.dropFirst())
        guard Self.identifier(id), url.path == "/" + id else { return }
        pendingTap = id
        openPendingTap()
    }
    private func openPendingTap() {
        guard let id = pendingTap, let view = webview, !view.isLoading, let accountId = accountId,
              let record = records.values.first(where: { $0.attributes.generationId == id && $0.accountId == accountId
                && NativeBridge.origin(URL(string: $0.serverOrigin)) == NativeBridge.origin(view.url) }),
              let url = URL(string: "/chat/" + record.attributes.chatId, relativeTo: view.url)?.absoluteURL else { return }
        pendingTap = nil
        guard !NativeChatNavigation.isCurrentChat(url, in: view.url) else { return }
        view.load(URLRequest(url: url))
    }
    private static func identifier(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil
    }
}
