import Foundation
import WebKit
import WidgetKit

@MainActor
final class IOSWidgets {
    static let shared = IOSWidgets()
    private weak var webview: WKWebView?
    private var accountId: String?
    private var configuredOrigin: String?
    private var pendingTap: String?
    static func reload() {
        WidgetCenter.shared.reloadTimelines(ofKind: "RecentCharactersWidget")
        WidgetCenter.shared.reloadTimelines(ofKind: "FavoriteCharactersWidget")
    }
    func attach(_ view: WKWebView) { webview = view }
    func status() -> [String: Any] {
        let available: Bool
        if #available(iOS 16.0, *) { available = Bundle.main.object(forInfoDictionaryKey: "LumiverseWidgetsEnabled") as? Bool == true }
        else { available = false }
        let record = CharacterWidgetStore.current()
        let valid = record.map { $0.accountId == accountId && NativeServerOrigin.matches($0.serverOrigin, configuredOrigin)
            && $0.expiresAt > Date().timeIntervalSince1970 * 1000 + 7 * 24 * 3600 * 1000
            && CharacterWidgetStore.credential(for: $0) != nil } ?? false
        return ["available": available,
                "deviceId": IOSNotifications.shared.installation["deviceId"]!, "needsEnrollment": !valid]
    }
    func configure(_ input: [String: Any]) throws {
        let account = input["accountId"] as? String
        let origin = NativeBridge.origin(webview?.url)
        let previous = CharacterWidgetStore.current()
        accountId = account
        configuredOrigin = origin
        if previous.map({ $0.accountId != account || !NativeServerOrigin.matches($0.serverOrigin, origin) }) ?? false {
            clear()
        }
        guard let account = account, origin != nil else { clear(); return }
        var palette = CharacterWidgetPalette()
        if let raw = input["palette"], let data = try? JSONSerialization.data(withJSONObject: raw),
           let decoded = try? JSONDecoder().decode(CharacterWidgetPalette.self, from: data), decoded.valid { palette = decoded }
        if let raw = input["enrollment"] as? [String: Any] {
            guard let id = raw["registrationId"] as? String, CharacterWidgetLink.identifier(id),
                  let credential = raw["credential"] as? String, credential.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
                  raw["accountId"] as? String == account, let expires = raw["expiresAt"] as? Double,
                  expires > Date().timeIntervalSince1970 * 1000, expires < Date().timeIntervalSince1970 * 1000 + 91 * 24 * 3600 * 1000,
                  let serverOrigin = input["serverOrigin"] as? String, let url = URLComponents(string: serverOrigin),
                  url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, url.path.isEmpty,
                  NativeServerOrigin.matches(serverOrigin, origin) else { throw CharacterWidgetStore.Failure.invalid }
            try CharacterWidgetStore.activate(CharacterWidgetEnrollment(registrationId: id, accountId: account,
                serverOrigin: serverOrigin, expiresAt: expires, palette: palette), credential: credential)
            Self.reload()
        } else if let active = CharacterWidgetStore.current(), active.palette.background != palette.background
                    || active.palette.foreground != palette.foreground || active.palette.accent != palette.accent {
            CharacterWidgetStore.updatePalette(palette, for: active); Self.reload()
        }
        openPendingTap()
    }
    private func clear() {
        let old = CharacterWidgetStore.current(), credential = old.flatMap { CharacterWidgetStore.credential(for: $0) }
        CharacterWidgetStore.invalidate(removeEnrollment: true)
        Self.reload()
        if let old = old, let credential = credential, let url = URL(string: old.serverOrigin + "/api/ios-widgets/v1/registrations/" + old.registrationId) {
            var request = URLRequest(url: url); request.httpMethod = "DELETE"
            request.setValue("Bearer " + credential, forHTTPHeaderField: "Authorization")
            // No browser cookies or redirect forwarding for revocation either.
            let config = URLSessionConfiguration.ephemeral; config.httpCookieStorage = nil; config.timeoutIntervalForRequest = 5
            let session = URLSession(configuration: config, delegate: WidgetRevocationDelegate(), delegateQueue: nil)
            session.dataTask(with: request) { _, _, _ in session.finishTasksAndInvalidate() }.resume()
        }
    }
    func selectedOriginChanged() {
        if configuredOrigin != nil, NativeBridge.origin(webview?.url) != configuredOrigin {
            accountId = nil; configuredOrigin = nil; pendingTap = nil; clear()
        }
        openPendingTap()
    }
    func invalidate() { CharacterWidgetStore.invalidate(); Self.reload() }
    func refresh() async {
        guard let active = CharacterWidgetStore.current(), active.accountId == accountId,
              NativeServerOrigin.matches(active.serverOrigin, NativeBridge.origin(webview?.url)) else { return }
        await CharacterWidgetRefresh().refresh(active)
        Self.reload()
        openPendingTap()
    }
    func open(_ raw: String) { pendingTap = raw; openPendingTap() }
    private func openPendingTap() {
        guard let raw = pendingTap, let view = webview, !view.isLoading, let active = CharacterWidgetStore.current(),
              active.accountId == accountId, NativeServerOrigin.matches(active.serverOrigin, NativeBridge.origin(view.url)),
              let snapshot = CharacterWidgetStore.snapshot(for: active) else { return }
        pendingTap = nil
        guard let path = CharacterWidgetLink.destination(raw, enrollment: active, snapshot: snapshot),
              let url = URL(string: active.serverOrigin + path), !NativeChatNavigation.isCurrentChat(url, in: view.url) else { return }
        view.load(URLRequest(url: url))
    }
}
private final class WidgetRevocationDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
