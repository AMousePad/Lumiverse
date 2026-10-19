import AVFoundation
import Speech
import UIKit
import WebKit

/// A small, origin-checked WebKit bridge. This does not grant remote Tauri IPC access.
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    private weak var webview: WKWebView?
    private let speech = NativeSpeech()
    private var mediaDelegate: MediaPermissionDelegate?
    private var loading: NSKeyValueObservation?
    private var lifecycleObservers: [NSObjectProtocol] = []
    private let cache: NativeCache?

    init(webview: WKWebView, cache: NativeCache? = nil) {
        self.webview = webview
        self.cache = cache
        super.init()
        let delegate = MediaPermissionDelegate(forwarding: webview.uiDelegate)
        mediaDelegate = delegate
        webview.uiDelegate = delegate
        webview.configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "lumiverseNative")
        loading = webview.observe(\.isLoading, options: [.new]) { [weak self] view, _ in
            if view.isLoading { self?.speech.cancel() }
        }
        IOSNotifications.shared.attach(webview: webview)
        // This wrapper uses scenes. Observe the WebView's own scene so a
        // foreground transition in another window cannot restore its presence.
        for (name, state) in [(UIScene.didActivateNotification, "active"),
                              (UIScene.willDeactivateNotification, "inactive"),
                              (UIScene.didEnterBackgroundNotification, "background")] {
            lifecycleObservers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                guard let webview = self?.webview, let scene = notification.object as? UIScene,
                      scene === webview.window?.windowScene else { return }
                webview.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('lumiverse:ios-app-state', {detail: detail}))",
                    arguments: ["detail": ["state": state]], in: nil, in: .page, completionHandler: nil)
            })
        }
    }

    deinit { for observer in lifecycleObservers { NotificationCenter.default.removeObserver(observer) } }

    private func appState(in webview: WKWebView) -> String {
        if let scene = webview.window?.windowScene {
            switch scene.activationState {
            case .foregroundActive: return "active"
            case .foregroundInactive: return "inactive"
            default: return "background"
            }
        }
        switch UIApplication.shared.applicationState {
        case .active: return "active"
        case .inactive: return "inactive"
        default: return "background"
        }
    }

    static func origin(_ url: URL?) -> String? {
        guard let url = url, let scheme = url.scheme?.lowercased(), ["https", "http"].contains(scheme),
              let host = url.host?.lowercased(), host != "tauri.localhost" else { return nil }
        let port = url.port ?? (scheme == "https" ? 443 : 80)
        return "\(scheme)://\(host):\(port)"
    }

    static func trusts(_ frame: WKFrameInfo, in webview: WKWebView) -> Bool {
        guard frame.isMainFrame, let current = origin(webview.url) else { return false }
        let security = frame.securityOrigin
        let port = security.port == 0 ? (security.protocol == "https" ? 443 : 80) : security.port
        return current == "\(security.protocol.lowercased())://\(security.host.lowercased()):\(port)"
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void) {
        guard let webview = webview, Self.trusts(message.frameInfo, in: webview),
              let body = message.body as? [String: Any], let action = body["action"] as? String else {
            replyHandler(nil, "Native access is limited to the selected server's main page.")
            return
        }
        let payload = body["payload"] as? [String: Any] ?? [:]
        switch action {
        case "cache.status": replyHandler(cache?.status ?? ["available": false, "active": false], nil)
        case "cache.ready": replyHandler(["accepted": cache?.markHealthy(buildId: payload["buildId"] as? String ?? "") ?? false], nil)
        case "lifecycle.status": replyHandler(["state": appState(in: webview)], nil)
        case "notifications.status": IOSNotifications.shared.status { replyHandler($0, nil) }
        case "notifications.register": IOSNotifications.shared.register { result, error in replyHandler(result, error) }
        case "speech.start":
            guard let id = payload["id"] as? String, UUID(uuidString: id) != nil,
                  let language = payload["language"] as? String, language.count <= 80 else {
                replyHandler(nil, "Invalid speech recognition request."); return
            }
            speech.start(id: id, language: language, webview: webview) { error in
                replyHandler(error == nil ? ["started": true] : nil, error)
            }
        case "speech.stop": speech.stop(id: payload["id"] as? String); replyHandler(["stopping": true], nil)
        case "speech.cancel": speech.cancel(id: payload["id"] as? String); replyHandler(["cancelled": true], nil)
        case "permissions.status":
            replyHandler(["microphone": Self.authorization(AVCaptureDevice.authorizationStatus(for: .audio)),
                "camera": Self.authorization(AVCaptureDevice.authorizationStatus(for: .video)),
                "speech": SFSpeechRecognizer.authorizationStatus().rawValue], nil)
        default: replyHandler(nil, "Unknown native action.")
        }
    }

    private static func authorization(_ status: AVAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "granted"
        case .notDetermined: return "default"
        default: return "denied"
        }
    }
}

/// Keep Tauri's other UI delegate methods, but let WebKit ask per-origin for capture.
private final class MediaPermissionDelegate: NSObject, WKUIDelegate {
    private let original: WKUIDelegate?
    init(forwarding original: WKUIDelegate?) { self.original = original; super.init() }
    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || (original?.responds(to: selector) ?? false)
    }
    override func forwardingTarget(for selector: Selector!) -> Any? {
        original?.responds(to: selector) == true ? original : super.forwardingTarget(for: selector)
    }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(NativeBridge.trusts(frame, in: webView) ? .prompt : .deny)
    }
}
