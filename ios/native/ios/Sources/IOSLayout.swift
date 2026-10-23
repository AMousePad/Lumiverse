import UIKit
import WebKit

/// Tracks the WebView's scene geometry without replacing its controller or scroll view.
final class IOSLayout: UIView {
    private weak var webview: WKWebView?
    private var lastGeometry: NSDictionary?
    private var revision = 0
    private var hingeStatus = "unknown"

    init(webview: WKWebView) {
        self.webview = webview
        super.init(frame: webview.bounds)
        autoresizingMask = [.flexibleWidth, .flexibleHeight]
        isUserInteractionEnabled = false
        accessibilityElementsHidden = true
        backgroundColor = .clear
        webview.insertSubview(self, at: 0)
        if #available(iOS 27.1, *) {
            addInteraction(UIHingeInteraction { [weak self] _, update in
                guard let self else { return }
                switch update.hinge?.status {
                case .closed?: self.hingeStatus = "closed"
                case .partiallyOpen?: self.hingeStatus = "partiallyOpen"
                case .fullyOpen?: self.hingeStatus = "fullyOpen"
                default: self.hingeStatus = "unknown"
                }
                // A fold can change reserved regions without changing the view's bounds.
                // The region frame, rather than hinge angle, determines pane placement.
                self.setNeedsLayout()
            })
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        publish()
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        setNeedsLayout()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        setNeedsLayout()
    }

    private func geometry() -> [String: Any] {
        guard let view = webview else { return [:] }
        let insets = view.safeAreaInsets
        var result: [String: Any] = [
            "version": 1, "width": view.bounds.width, "height": view.bounds.height,
            "horizontalSizeClass": view.traitCollection.horizontalSizeClass.rawValue,
            "verticalSizeClass": view.traitCollection.verticalSizeClass.rawValue,
            "hingeStatus": hingeStatus,
            "safeArea": ["top": insets.top, "right": insets.right, "bottom": insets.bottom, "left": insets.left],
            "divisions": [], "occlusions": []
        ]
        if #available(iOS 27.1, *) {
            func encode(_ region: UIView.ReservedRegion) -> [String: Any] {
                let frame = region.frame
                return ["x": frame.minX - view.bounds.minX, "y": frame.minY - view.bounds.minY,
                        "width": frame.width, "height": frame.height, "isActive": region.isActive]
            }
            result["divisions"] = view.reservedRegions(kind: .division, options: .includeInactive).map(encode)
            result["occlusions"] = view.reservedRegions(kind: .occlusion).map(encode)
        }
        return result
    }

    func snapshot() -> [String: Any] {
        let current = geometry()
        if lastGeometry?.isEqual(to: current) != true {
            lastGeometry = current as NSDictionary
            revision += 1
        }
        return current.merging(["revision": revision]) { _, new in new }
    }

    private func publish() {
        let previous = revision
        let current = snapshot()
        guard revision != previous, let webview else { return }
        webview.callAsyncJavaScript(
            "window.dispatchEvent(new CustomEvent('lumiverse:ios-layout', {detail: layout}))",
            arguments: ["layout": current], in: nil, in: .page, completionHandler: nil)
    }
}
