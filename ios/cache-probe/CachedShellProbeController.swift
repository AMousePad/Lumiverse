import UIKit
import WebKit

/// A cold-process disk restore experiment. This separate app has no updater,
/// server picker, downloaded bundles, or access to the real wrapper's data.
final class CachedShellProbeController: UIViewController {
    private let stage: Bool
    private var webview: WKWebView!
    private var bridge: NativeBridge?
    private let status = UILabel()
    private var deadline = Date()
    private let origin = URL(string: "https://lumiverse-cache-probe.invalid/")!

    init(stage: Bool) { self.stage = stage; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        status.text = "Opening disk shell"
        status.font = .systemFont(ofSize: 12)
        status.accessibilityIdentifier = "cache-probe-status"
        status.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(status)
        do {
            let config = WKWebViewConfiguration()
            config.websiteDataStore = .default()
            let script = try String(contentsOf: Bundle.main.url(forResource: "mobile-init", withExtension: "js")!)
            config.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: false))
            webview = WKWebView(frame: .zero, configuration: config)
            bridge = NativeBridge(webview: webview)
            webview.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(webview)
            NSLayoutConstraint.activate([
                status.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
                status.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
                status.heightAnchor.constraint(equalToConstant: 28),
                webview.topAnchor.constraint(equalTo: status.bottomAnchor),
                webview.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                webview.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                webview.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            ])
            let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                .appendingPathComponent("NativeCacheProbe", isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            let cached = root.appendingPathComponent("shell.html")
            if stage {
                let source = Bundle.main.url(forResource: "frontend", withExtension: nil)!.appendingPathComponent("supplied.html")
                try Data(contentsOf: source).write(to: cached, options: .atomic)
            }
            // Restore reads only the app's persisted file; it does not read the
            // bundled frontend or make a request for the document URL.
            let html = try Data(contentsOf: cached)
            let load = { [weak self] in
                guard let self = self else { return }
                let response = HTTPURLResponse(url: self.origin, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/html; charset=utf-8"])!
                self.deadline = Date().addingTimeInterval(30)
                self.webview.loadSimulatedRequest(URLRequest(url: self.origin), response: response, responseData: html)
                self.checkShell()
            }
            if stage {
                let cookie = HTTPCookie(properties: [.domain: origin.host!, .path: "/", .name: "cache_probe_session", .value: "fixture", .secure: "TRUE", .expires: Date().addingTimeInterval(3600)])!
                config.websiteDataStore.httpCookieStore.setCookie(cookie, completionHandler: load)
            } else { load() }
        } catch { status.text = "Cache probe failed: \(error)" }
    }

    private func checkShell() {
        webview.evaluateJavaScript("document.querySelector('#root')?.children.length > 0 && !!window.__lumiverseDisplayPerformance?.snapshot().milestones.interactive && location.origin === 'https://lumiverse-cache-probe.invalid'") { [weak self] result, _ in
            guard let self = self else { return }
            if result as? Bool == true {
                self.webview.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
                    let restored = cookies.contains { $0.name == "cache_probe_session" && $0.value == "fixture" && $0.domain == "lumiverse-cache-probe.invalid" }
                    self?.status.text = restored ? "Disk shell ready; session cookie restored" : "Disk shell ready; session cookie missing"
                }
            } else if Date() < self.deadline {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in self?.checkShell() }
            } else { self.status.text = "Cache probe failed to render" }
        }
    }
}
