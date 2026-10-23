import XCTest
import UIKit
import WebKit

@MainActor
final class NativeRegressionTests: XCTestCase {
    func testHandoffCoversDelayedTokenAndRelayEnrollmentWithoutReleasingEarly() {
        var expirations: [@MainActor @Sendable () -> Void] = []
        var ended: [UIBackgroundTaskIdentifier] = []
        let handoff = LiveActivityHandoff(begin: { expiration in
            expirations.append(expiration)
            return UIBackgroundTaskIdentifier(rawValue: expirations.count)
        }, end: { ended.append($0) })
        var expired = false
        // Before Activity.request: the app may background before a token exists.
        XCTAssertTrue(handoff.begin("activity") { expired = true })
        // A delayed token starts relay enrollment, then its backend upload.
        XCTAssertTrue(handoff.begin("activity") { XCTFail("Must reuse the initial handoff") })
        XCTAssertEqual(expirations.count, 1)
        XCTAssertTrue(ended.isEmpty)
        // Only successful backend registration releases background execution.
        handoff.end("activity")
        handoff.end("activity")
        XCTAssertEqual(ended.map(\.rawValue), [1])
        expirations[0]()
        XCTAssertFalse(expired, "A completed assertion must not expire a registered card")
    }

    func testExpirationCleansUpOnceAndCannotCancelAReplacementHandoff() {
        var expirations: [@MainActor @Sendable () -> Void] = []
        var ended: [Int] = []
        let handoff = LiveActivityHandoff(begin: {
            expirations.append($0)
            return UIBackgroundTaskIdentifier(rawValue: expirations.count)
        }, end: { ended.append($0.rawValue) })
        var cleanups = 0
        handoff.begin("activity") { cleanups += 1 }
        expirations[0]()
        expirations[0]()
        XCTAssertEqual(cleanups, 1)
        XCTAssertEqual(ended, [1])
        handoff.begin("activity") { cleanups += 1 }
        expirations[0]()
        XCTAssertEqual(ended, [1])
        handoff.end("activity")
        XCTAssertEqual(ended, [1, 2])
        let refused = LiveActivityHandoff(begin: { _ in .invalid }, end: { _ in XCTFail("Invalid assertion") })
        XCTAssertFalse(refused.begin("activity") { XCTFail("No task was started") })
    }

    func testWrapperTextMatchesOpaqueWebKitAtMultipleUIScales() async throws {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 300))
        let controller = UIViewController()
        window.rootViewController = controller
        window.makeKeyAndVisible()
        defer { window.isHidden = true }
        for (background, foreground) in [("#0a0812", "#eeeaf8"), ("#ffffff", "#18141f")] {
            for scale in [0.85, 1.0, 1.25] {
                let html = """
                <meta name="viewport" content="width=device-width,initial-scale=1">
                <style>html{-webkit-text-size-adjust:100%;-webkit-font-smoothing:auto;background:\(background)}
                body{margin:0;font-family:-apple-system;font-size:14px;line-height:1.5;color:\(foreground);zoom:\(scale)}
                h1{font-size:20px;font-weight:600}p{margin:8px 0}button{font:inherit}
                </style><h1>Lumiverse Aa Ee 123</h1><p>Preparing response · Thinking · Writing response</p>
                <p>Thin strokes: iltf / AVMW / The quick brown fox.</p><button>Settings and notifications</button>
                """
                let reference = try await snapshot(html, controller: controller, configure: false)
                let wrapper = try await snapshot(html, controller: controller, configure: true)
                XCTAssertEqual(wrapper.pngData(), reference.pngData(), "Typography differs at scale \(scale), background \(background)")
                let attachment = XCTAttachment(image: wrapper)
                attachment.name = "Opaque WebKit text \(background) scale \(scale)"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
    }

    private func snapshot(_ html: String, controller: UIViewController, configure: Bool) async throws -> UIImage {
        let webview = WKWebView(frame: controller.view.bounds)
        if configure {
            // Reproduce Wry's configuration for an explicit launch background.
            webview.isOpaque = false
            webview.backgroundColor = UIColor(red: 10/255, green: 8/255, blue: 18/255, alpha: 1)
            WebViewRendering.configure(webview)
        }
        XCTAssertTrue(webview.isOpaque)
        controller.view.addSubview(webview)
        defer { webview.removeFromSuperview() }
        let loader = HTMLLoader()
        webview.navigationDelegate = loader
        try await loader.load(html, in: webview)
        _ = try await webview.callAsyncJavaScript("await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));",
            arguments: [:], in: nil, contentWorld: .page)
        let configuration = WKSnapshotConfiguration()
        configuration.afterScreenUpdates = true
        let image = try await webview.takeSnapshot(configuration: configuration)
        let cgImage = try XCTUnwrap(image.cgImage)
        let bytes = try XCTUnwrap(cgImage.dataProvider?.data) as Data
        let colors = Set(stride(from: 0, to: bytes.count - 3, by: 4).map { offset in
            UInt32(bytes[offset]) << 16 | UInt32(bytes[offset + 1]) << 8 | UInt32(bytes[offset + 2])
        })
        XCTAssertGreaterThan(colors.count, 32, "Snapshot must contain rendered antialiased text, not a blank surface")
        return image
    }
}

@MainActor
private final class HTMLLoader: NSObject, WKNavigationDelegate {
    private var continuation: CheckedContinuation<Void, Error>?
    func load(_ html: String, in webview: WKWebView) async throws {
        try await withCheckedThrowingContinuation {
            continuation = $0
            webview.loadHTMLString(html, baseURL: nil)
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        continuation?.resume(); continuation = nil
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        continuation?.resume(throwing: error); continuation = nil
    }
}
