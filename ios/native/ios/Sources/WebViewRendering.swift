import UIKit
import WebKit

enum WebViewRendering {
    static func configure(_ webview: WKWebView) {
        // Wry makes WKWebView nonopaque when applying our launch background.
        // This app paints a full document surface and has no native material
        // behind it. Use WKWebView's ordinary opaque backing,
        // rather than compositing every glyph through a transparent surface.
        webview.isOpaque = true
    }
}
