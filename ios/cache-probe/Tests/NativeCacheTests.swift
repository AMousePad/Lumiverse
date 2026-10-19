import XCTest
import WebKit
@testable import CacheProbe

/// Exercises the public APIs proposed in the plan, with the real native bridge
/// and a release frontend build. This is not the production cache/updater.
@MainActor
final class NativeCacheTests: XCTestCase {
    private var webview: WKWebView!
    private var assets: DiskAssetHandler!
    private var bridge: NativeBridge!
    private var origin = "https://lumiverse-cache-probe.invalid"

    override func tearDown() {
        webview?.stopLoading()
        webview?.removeFromSuperview()
        // The content controller retains the bridge; explicitly break that link.
        webview?.configuration.userContentController.removeScriptMessageHandler(forName: "lumiverseNative", contentWorld: .page)
        bridge = nil
        webview = nil
        assets = nil
        super.tearDown()
    }

    private func makeWebView(files: URL) throws {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        assets = DiskAssetHandler(root: files, origin: origin)
        // Register BEFORE construction, as Tauri must do for its protocol.
        config.setURLSchemeHandler(assets, forURLScheme: "lumiverse-cache")
        let script = try String(contentsOf: XCTUnwrap(Bundle.main.url(forResource: "mobile-init", withExtension: "js")))
        config.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        config.userContentController.addUserScript(WKUserScript(source: """
            window.__cacheProbeErrors = [];
            addEventListener('error', e => __cacheProbeErrors.push(e.message || e.target?.src || 'resource error'), true);
            addEventListener('unhandledrejection', e => __cacheProbeErrors.push(String(e.reason)));
            addEventListener('securitypolicyviolation', e => __cacheProbeErrors.push('CSP: ' + e.effectiveDirective + ' ' + e.blockedURI));
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webview = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: config)
        bridge = NativeBridge(webview: webview)
        let window = (UIApplication.shared.delegate as? CacheProbeApp)?.window
        window?.rootViewController?.view.addSubview(webview)
    }

    private func load(_ html: String, path: String = "/") throws {
        let url = try XCTUnwrap(URL(string: origin + path))
        let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: lumiverse-cache:; style-src 'self' 'unsafe-inline' lumiverse-cache:; img-src 'self' data: lumiverse-cache:; font-src data: lumiverse-cache:; connect-src 'self' lumiverse-cache:; worker-src 'self' blob: lumiverse-cache:",
        ]))
        webview.loadSimulatedRequest(URLRequest(url: url), response: response, responseData: Data(html.utf8))
    }

    private func js(_ expression: String) async throws -> Any? {
        try await webview.evaluateJavaScript(expression)
    }

    private func asyncJS(_ source: String, arguments: [String: Any] = [:]) async throws -> Any {
        try await withCheckedThrowingContinuation { continuation in
            webview.callAsyncJavaScript(source, arguments: arguments, in: nil, in: .page) {
                continuation.resume(with: $0)
            }
        }
    }

    private func assertJS(_ expression: String, equals expected: String) async throws {
        let value = try await js("String(\(expression))") as? String
        XCTAssertEqual(value, expected, expression)
    }

    private func waitFor(_ expression: String, seconds: Double = 15) async throws {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if (try? await js(expression)) as? Bool == true { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let errors = try? await js("JSON.stringify(window.__cacheProbeErrors)")
        XCTFail("Timed out: \(expression). JS errors: \(errors ?? "none"). Assets: \(assets.requests). Failures: \(assets.failures)")
        throw ProbeError.timeout
    }

    private func fixture(_ files: [String: String]) throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        for (path, content) in files { try Data(content.utf8).write(to: root.appendingPathComponent(path)) }
        return root
    }

    func testSuppliedHTTPSDocumentRetainsOriginCookiesAndBridgeIsolation() async throws {
        try makeWebView(files: fixture([:]))
        let cookie = try XCTUnwrap(HTTPCookie(properties: [.domain: "lumiverse-cache-probe.invalid", .path: "/", .name: "probe_session", .value: "fixture", .secure: "TRUE"]))
        await webview.configuration.websiteDataStore.httpCookieStore.setCookie(cookie)
        try load("""
            <!doctype html><body><h1>Cached shell</h1><script>
            window.result = {};
            (async () => {
              result.origin = location.origin; result.secure = isSecureContext;
              result.relative = new URL('/api/v1/runtime-config', location.href).href;
              result.cookie = document.cookie;
              result.bridge = (await __LUMIVERSE_IOS_NATIVE__.request('lifecycle.status')).state;
              try { await __LUMIVERSE_IOS_NATIVE__.request('fs.read'); result.denied = false; }
              catch { result.denied = true; }
              addEventListener('message', e => { if (e.origin === location.origin) result.frameDenied = e.data.denied; });
              const frame = document.createElement('iframe');
              frame.srcdoc = `<script>webkit.messageHandlers.lumiverseNative.postMessage({action:'lifecycle.status'}).then(() => parent.postMessage({denied:false}, '*'), () => parent.postMessage({denied:true}, '*'))<\\/script>`;
              document.body.append(frame);
            })();</script></body>
            """)
        try await waitFor("window.result?.frameDenied === true")
        let value = try await js("result")
        let result = try XCTUnwrap(value as? [String: Any])
        XCTAssertEqual(result["origin"] as? String, origin)
        XCTAssertEqual(result["secure"] as? Bool, true)
        XCTAssertEqual(result["relative"] as? String, origin + "/api/v1/runtime-config")
        XCTAssertEqual(result["cookie"] as? String, "probe_session=fixture")
        XCTAssertEqual(result["denied"] as? Bool, true)
        XCTAssertNotNil(result["bridge"] as? String)
    }

    func testDiskSchemeFromLoopbackHTTPDocument() async throws {
        origin = "http://127.0.0.1:18764"
        try await checkDiskSchemeModules()
    }

    func testHTTPSCustomSchemeCompatibilityReport() async throws {
        let bundled = try XCTUnwrap(Bundle.main.url(forResource: "frontend", withExtension: nil))
        try makeWebView(files: bundled)
        try load(String(contentsOf: bundled.appendingPathComponent("index.html")))
        try await waitFor("window.__cacheProbeErrors?.length > 0 || document.querySelector('#root')?.children.length > 0")
        let errors = try await js("JSON.stringify(__cacheProbeErrors)")
        let rendered = try await js("document.querySelector('#root')?.children.length > 0")
        let attachment = XCTAttachment(string: "Rendered: \(rendered ?? false)\nErrors: \(errors ?? "none")\nRequests: \(assets.requests)\nFailures: \(assets.failures)")
        attachment.name = "HTTPS custom-scheme candidate compatibility (diagnostic, not an acceptance gate)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func checkDiskSchemeModules(host: String = "bundle") async throws {
        try makeWebView(files: fixture([
            "entry.js": "import { value } from './dependency.js'; const lazy = await import('./lazy.js'); const r = await fetch('lumiverse-cache://\(host)/data.json'); window.moduleResult = { value, lazy: lazy.value, data: await r.json() };",
            "dependency.js": "export const value = 42;",
            "lazy.js": "export const value = 'lazy';",
            "style.css": "body { --cache-probe: disk; }",
            "data.json": "{\"disk\":true}",
        ]))
        try load("""
            <!doctype html><link rel="stylesheet" href="lumiverse-cache://\(host)/style.css">
            <script type="module" crossorigin src="lumiverse-cache://\(host)/entry.js"></script><body>Cache transport</body>
            """)
        try await waitFor("window.moduleResult?.data?.disk === true", seconds: 5)
        try await assertJS("moduleResult.value", equals: "42")
        try await assertJS("moduleResult.lazy", equals: "lazy")
        try await assertJS("getComputedStyle(document.body).getPropertyValue('--cache-probe').trim()", equals: "disk")
        XCTAssertTrue(assets.requests.contains(where: { $0.hasSuffix("/dependency.js") }))
        XCTAssertTrue(assets.requests.contains(where: { $0.hasSuffix("/lazy.js") }))
    }

    func testProductionFrontendCanRenderFromDiskWithoutServer() async throws {
        let bundled = try XCTUnwrap(Bundle.main.url(forResource: "frontend", withExtension: nil))
        let disk = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.copyItem(at: bundled, to: disk)
        addTeardownBlock { try? FileManager.default.removeItem(at: disk) }
        try makeWebView(files: disk)
        try load(String(contentsOf: disk.appendingPathComponent("supplied.html")))
        try await waitFor("document.querySelector('#root')?.children.length > 0 && !!window.__lumiverseDisplayPerformance?.snapshot().milestones.interactive", seconds: 30)
        try await assertJS("location.origin", equals: origin)
        XCTAssertTrue(assets.requests.isEmpty, "The supplied variant must not rely on custom-scheme resources.")
        let snapshot = try await js("JSON.stringify(__lumiverseDisplayPerformance.snapshot())")
        let attachment = XCTAttachment(string: "\(snapshot ?? "none")\nAssets: \(assets.requests)")
        attachment.name = "Production frontend from native disk cache"
        attachment.lifetime = .keepAlways
        add(attachment)
        let image = try await webview.takeSnapshot(configuration: nil)
        add(XCTAttachment(image: image))
    }

    func testProductionWorkersAndAudioWorkletCanStartFromSameOriginBlobs() async throws {
        let bundled = try XCTUnwrap(Bundle.main.url(forResource: "frontend", withExtension: nil))
        let workerBytes = try Data(contentsOf: bundled.appendingPathComponent("workers.json"))
        let sources = try XCTUnwrap(JSONSerialization.jsonObject(with: workerBytes) as? [String: String])
        XCTAssertEqual(Set(sources.keys), Set(["apply", "scheduler-canary", "heartbeat", "capture", "whistle"]))
        try makeWebView(files: fixture([:]))
        try load("<!doctype html><body>Worker compatibility</body>")
        try await waitFor("location.origin === '\(origin)' && document.readyState === 'complete'")
        let workerProbe = """
            const blob = source => URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
            const probe = (name, initial, accepts) => new Promise((resolve, reject) => {
              const url = blob(sources[name]), worker = new Worker(url, {type:'module'});
              const finish = (error, data) => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); error ? reject(error) : resolve(data); };
              const timer = setTimeout(() => finish(new Error(name + ' timeout')), 8000);
              worker.onerror = e => finish(new Error(name + ': ' + e.message));
              worker.onmessage = e => { if (accepts(e.data)) finish(null, e.data); };
              if (initial) worker.postMessage(initial);
            });
            const regex = await probe('apply', {jobId:1,op:'apply',body:'cached shell',scripts:[{pattern:'cached',flags:'g',replaceString:'native',trimStrings:[]}]}, d => d.type === 'result');
            const canary = await probe('scheduler-canary', null, d => d.type === 'heartbeat');
            const heartbeat = await probe('heartbeat', {type:'start',generation:1,intervalMs:20,timeoutMs:1000}, d => d.type === 'ping');
            // Large model downloads remain live. An error reply proves the real
            // worker ran and handled the unavailable fixture server normally.
            const whistle = await probe('whistle', {type:'prepare',id:1}, d => d.type === 'error' && d.id === 1);
            const context = new AudioContext(), workletURL = blob(sources.capture);
            let node;
            try {
              await context.audioWorklet.addModule(workletURL);
              node = new AudioWorkletNode(context, 'lumiverse-whistle-capture');
              return {regex:regex.result,canary:canary.type,heartbeat:heartbeat.type,whistle:whistle.type,worklet:!!node};
            } finally { node?.disconnect(); await context.close(); URL.revokeObjectURL(workletURL); }
            """
        let result = try await asyncJS(workerProbe, arguments: ["sources": sources])
        let values = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(values["regex"] as? String, "native shell")
        XCTAssertEqual(values["canary"] as? String, "heartbeat")
        XCTAssertEqual(values["heartbeat"] as? String, "ping")
        XCTAssertEqual(values["whistle"] as? String, "error")
        XCTAssertEqual(values["worklet"] as? Bool, true)
    }

    func testSuppliedWasmBytesCompileUnderNativePolicy() async throws {
        try makeWebView(files: fixture([:]))
        try load("<!doctype html><body>Cached WASM</body>")
        try await waitFor("location.origin === '\(origin)' && document.readyState === 'complete'")
        let result = try await asyncJS("""
            const bytes = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,9,1,5,118,97,108,117,101,0,0,10,6,1,4,0,65,42,11]);
            const compiled = await WebAssembly.instantiate(bytes);
            return compiled.instance.exports.value();
            """)
        XCTAssertEqual(result as? Int, 42)
    }
}

private enum ProbeError: Error { case timeout }

/// Deliberately small test adapter. The eventual production handler must serve
/// a verified, origin-bound manifest inventory, enforce quotas, and stream IO.
private final class DiskAssetHandler: NSObject, WKURLSchemeHandler {
    private let root: URL
    private let origin: String
    private(set) var requests: [String] = []
    private(set) var failures: [String] = []
    init(root: URL, origin: String) { self.root = root; self.origin = origin }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        requests.append(urlSchemeTask.request.url?.absoluteString ?? "missing URL")
        guard let url = urlSchemeTask.request.url, ["bundle", "localhost"].contains(url.host ?? ""),
              !url.path.contains(".."), url.query == nil,
              let data = try? Data(contentsOf: root.appendingPathComponent(url.path)) else {
            failures.append("Missing or rejected: \(urlSchemeTask.request.url?.absoluteString ?? "none") in \(root)")
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        let mime = ["js": "text/javascript", "css": "text/css", "html": "text/html", "json": "application/json", "woff2": "font/woff2", "wasm": "application/wasm", "svg": "image/svg+xml", "png": "image/png"][url.pathExtension] ?? "application/octet-stream"
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": mime, "Access-Control-Allow-Origin": origin, "Cache-Control": "no-store"])!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
