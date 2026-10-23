import Foundation

/// Used by both the foreground host and WidgetKit's budgeted timeline refresh.
final class CharacterWidgetRefresh: NSObject, URLSessionTaskDelegate {
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 12
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    private func download(_ path: String, enrollment: CharacterWidgetEnrollment, credential: String, maximum: Int) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: enrollment.serverOrigin + path) else { throw CharacterWidgetStore.Failure.invalid }
        var request = URLRequest(url: url)
        request.setValue("Bearer " + credential, forHTTPHeaderField: "Authorization")
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, http.expectedContentLength <= maximum else { throw CharacterWidgetStore.Failure.network }
        var data = Data()
        for try await byte in bytes {
            guard data.count < maximum else { throw CharacterWidgetStore.Failure.network }
            data.append(byte)
        }
        return (data, http)
    }
    func refresh(_ enrollment: CharacterWidgetEnrollment) async {
        let deadline = DispatchWorkItem { [session] in session.invalidateAndCancel() }
        DispatchQueue.global().asyncAfter(deadline: .now() + 24, execute: deadline)
        defer { deadline.cancel(); session.finishTasksAndInvalidate() }
        guard enrollment.expiresAt > Date().timeIntervalSince1970 * 1000 else {
            CharacterWidgetStore.invalidate(expected: enrollment.registrationId, removeEnrollment: true); return
        }
        guard let credential = CharacterWidgetStore.credential(for: enrollment) else { return }
        let revision = CharacterWidgetStore.revision()
        let base = "/api/ios-widgets/v1/registrations/" + enrollment.registrationId
        do {
            let (data, response) = try await download(base + "/snapshot", enrollment: enrollment, credential: credential, maximum: 64 * 1024)
            if [401, 403].contains(response.statusCode) {
                CharacterWidgetStore.invalidate(expected: enrollment.registrationId, removeEnrollment: true); return
            }
            guard response.statusCode == 200, response.mimeType == "application/json" else { return }
            var snapshot = try JSONDecoder().decode(CharacterWidgetSnapshot.self, from: data)
            guard snapshot.valid, snapshot.accountId == enrollment.accountId else { return }
            var keys: [String: String] = [:], images: [String: Data] = [:]
            let ids = Array(Set((snapshot.recent + snapshot.favorites).map { $0.characterId }))
            for offset in stride(from: 0, to: ids.count, by: 4) {
                let results = await withTaskGroup(of: (String, Data?).self, returning: [(String, Data?)].self) { group in
                    for id in ids[offset..<min(offset + 4, ids.count)] {
                        group.addTask {
                            guard let (data, response) = try? await self.download(base + "/characters/" + id + "/portrait",
                                enrollment: enrollment, credential: credential, maximum: 256 * 1024),
                                  response.statusCode == 200, response.mimeType == "image/jpeg" else { return (id, nil) }
                            return (id, CharacterWidgetStore.boundedJPEG(data))
                        }
                    }
                    var result: [(String, Data?)] = []
                    for await item in group { result.append(item) }
                    return result
                }
                for (id, image) in results {
                    if let image = image { let key = UUID().uuidString; keys[id] = key; images[key] = image }
                }
            }
            snapshot.recent = snapshot.recent.map { var item = $0; item.imageKey = keys[item.characterId]; return item }
            snapshot.favorites = snapshot.favorites.map { var item = $0; item.imageKey = keys[item.characterId]; return item }
            try CharacterWidgetStore.commit(snapshot, images: images, enrollment: enrollment, revision: revision)
        } catch { /* Keep the last committed snapshot while this server is offline. */ }
    }
}
