import UIKit
import WebKit

/// Stream both blob exports and authenticated responses through WebKit, retaining
/// its cookies and Tauri's navigation policy. Only finished files enter Documents.
final class NativeDownloads: NSObject, WKNavigationDelegate, WKDownloadDelegate {
    private weak var webview: WKWebView?
    private let original: WKNavigationDelegate?
    private var active: [ObjectIdentifier: (download: WKDownload, temporary: URL, filename: String)] = [:]

    init(webview: WKWebView) {
        self.webview = webview
        original = webview.navigationDelegate
        super.init()
        webview.navigationDelegate = self
    }

    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || (original?.responds(to: selector) ?? false)
    }

    override func forwardingTarget(for selector: Selector!) -> Any? {
        original?.responds(to: selector) == true ? original : super.forwardingTarget(for: selector)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload {
            decisionHandler(NativeBridge.trusts(action.sourceFrame, in: webView) ? .download : .cancel)
        } else if original?.webView?(webView, decidePolicyFor: action, decisionHandler: decisionHandler) == nil {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if response.isForMainFrame && !response.canShowMIMEType {
            decisionHandler(.download)
        } else if original?.webView?(webView, decidePolicyFor: response, decisionHandler: decisionHandler) == nil {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
        suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            completionHandler(nil)
            showResult(filename: Self.safeFilename(suggestedFilename), success: false)
            return
        }
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("lumiverse-export-" + UUID().uuidString)
        active[ObjectIdentifier(download)] = (download, temporary, Self.safeFilename(suggestedFilename))
        completionHandler(temporary)
    }

    static func safeFilename(_ suggested: String) -> String {
        let name = (suggested.replacingOccurrences(of: "\\", with: "/") as NSString).lastPathComponent
            .components(separatedBy: .controlCharacters).joined()
            .trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
        // Leave room for a collision suffix without exceeding filesystem limits.
        var result = ""
        for character in name {
            if (result + String(character)).utf8.count > 220 { break }
            result.append(character)
        }
        return result.isEmpty ? "export" : result
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let item = active.removeValue(forKey: ObjectIdentifier(download)) else { return }
        do {
            let files = FileManager.default
            let documents = try files.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let name = item.filename as NSString
            let ext = name.pathExtension.isEmpty ? "" : "." + name.pathExtension
            var destination = documents.appendingPathComponent(item.filename)
            var number = 1
            while files.fileExists(atPath: destination.path) {
                destination = documents.appendingPathComponent("\(name.deletingPathExtension) (\(number))\(ext)")
                number += 1
            }
            try files.moveItem(at: item.temporary, to: destination)
            showResult(filename: destination.lastPathComponent, success: true)
        } catch {
            try? FileManager.default.removeItem(at: item.temporary)
            showResult(filename: item.filename, success: false)
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard let item = active.removeValue(forKey: ObjectIdentifier(download)) else { return }
        try? FileManager.default.removeItem(at: item.temporary)
        showResult(filename: item.filename, success: false)
    }

    private func showResult(filename: String, success: Bool) {
        guard let controller = webview?.window?.rootViewController, controller.presentedViewController == nil else { return }
        let deviceFolder = UIDevice.current.userInterfaceIdiom == .pad ? "On My iPad" : "On My iPhone"
        let alert = UIAlertController(title: success ? "Export saved" : "Export failed",
            message: success ? "\(filename)\nFiles → \(deviceFolder) → Lumiverse" : "Could not save \(filename). Check your connection and available storage, then try again.",
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        controller.present(alert, animated: true)
    }
}
