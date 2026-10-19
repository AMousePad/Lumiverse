import CryptoKit
import Foundation
import UIKit
import WebKit

/// First device preview: a versioned frontend shipped in the IPA, copied into
/// an origin-scoped native store. Live API/auth/media traffic stays in WebKit.
/// Server-distributed bundle updates and runtime media caching are separate work.
final class NativeCache {
    struct Manifest: Decodable {
        let schemaVersion: Int
        let buildId: String
        let appVersion: String
        let bytes: Int
        let sha256: String

        var valid: Bool {
            schemaVersion == 1 && bytes > 0 && bytes <= 24 * 1024 * 1024
                && buildId.range(of: "^[a-zA-Z0-9_-]{1,96}$", options: .regularExpression) != nil
                && sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
        }
    }

    private weak var webview: WKWebView?
    private let queue = DispatchQueue(label: "chat.lumiverse.native-cache", qos: .userInitiated)
    private var generation = UUID()
    private var loadingSupplied = false
    private var observation: NSKeyValueObservation?
    private var healthCheck: DispatchWorkItem?
    private var manifest: Manifest?
    private var selected: URL?
    private(set) var isActive = false
    private(set) var healthy = false

    static var available: Bool {
        Bundle.main.url(forResource: "manifest", withExtension: "json", subdirectory: "ios-native-cache-preview") != nil
    }

    init(webview: WKWebView) {
        self.webview = webview
        observation = webview.observe(\.isLoading, options: [.new]) { [weak self] view, _ in
            guard let self = self else { return }
            if view.isLoading && !self.loadingSupplied {
                let wasActive = self.isActive
                self.isActive = false
                self.healthy = false
                self.healthCheck?.cancel()
                self.generation = UUID()
                if wasActive { self.writeDiagnostics() }
            } else if !view.isLoading { self.loadingSupplied = false }
        }
    }

    private static func digest(_ bytes: Data) -> String {
        SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
    private func key(_ server: URL) -> String { Self.digest(Data((NativeBridge.origin(server) ?? "").utf8)) }
    private func disabledKey(_ server: URL) -> String { "native-cache.network-only.\(key(server))" }
    private func failedKey(_ server: URL) -> String { "native-cache.failed-build.\(key(server))" }

    var status: [String: Any] {
        ["available": Self.available, "active": isActive, "healthy": healthy,
         "buildId": manifest?.buildId ?? "", "version": manifest?.appVersion ?? "",
         "bytes": manifest?.bytes ?? 0, "source": "bundled-preview"]
    }

    func markHealthy(buildId: String) -> Bool {
        guard isActive, manifest?.buildId == buildId,
              NativeBridge.origin(webview?.url) == NativeBridge.origin(selected) else { return false }
        healthy = true
        healthCheck?.cancel()
        writeDiagnostics()
        return true
    }

    private func writeDiagnostics() {
        var snapshot = status
        snapshot["origin"] = NativeBridge.origin(selected) ?? ""
        snapshot["recordedAt"] = ISO8601DateFormatter().string(from: Date())
        queue.async {
            guard let bytes = try? JSONSerialization.data(withJSONObject: snapshot, options: [.sortedKeys]),
                  let support = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true) else { return }
            let root = support.appendingPathComponent("NativeCache", isDirectory: true)
            try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            try? bytes.write(to: root.appendingPathComponent("status.json"), options: .atomic)
        }
    }

    func load(server: URL, force: Bool = false, completion: @escaping (Bool) -> Void) {
        guard Self.available, NativeBridge.origin(server) != nil,
              server.user == nil, server.password == nil, let webview = webview else { completion(false); return }
        if !force && UserDefaults.standard.bool(forKey: disabledKey(server)) { completion(false); return }
        let token = UUID()
        generation = token
        healthCheck?.cancel()
        let originKey = key(server)
        let failed = UserDefaults.standard.string(forKey: failedKey(server))
        queue.async { [weak self, weak webview] in
            do {
                guard let descriptor = Bundle.main.url(forResource: "manifest", withExtension: "json", subdirectory: "ios-native-cache-preview") else { throw CacheError.invalidBundle }
                let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: descriptor))
                guard manifest.valid, force || failed != manifest.buildId else { throw CacheError.invalidBundle }
                let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                var root = support.appendingPathComponent("NativeCache/servers/\(originKey)/builds", isDirectory: true)
                let directory = root.appendingPathComponent(manifest.buildId, isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                var values = URLResourceValues(); values.isExcludedFromBackup = true
                try root.setResourceValues(values)
                let cached = directory.appendingPathComponent("shell.html")
                var data = try? Data(contentsOf: cached, options: .mappedIfSafe)
                if data?.count != manifest.bytes || data.map(Self.digest) != manifest.sha256 {
                    guard let source = Bundle.main.url(forResource: "native-shell", withExtension: "html", subdirectory: "ios-native-cache-preview") else { throw CacheError.invalidBundle }
                    let supplied = try Data(contentsOf: source, options: .mappedIfSafe)
                    guard supplied.count == manifest.bytes, Self.digest(supplied) == manifest.sha256 else { throw CacheError.invalidBundle }
                    try supplied.write(to: cached, options: .atomic)
                    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: cached.path)
                    data = supplied
                }
                // The preview retains at most two bundled generations per
                // server; there are no API responses or credentials here.
                let generations = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
                let previous = generations.filter { $0 != directory }.sorted {
                    ((try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast)
                        > ((try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast)
                }
                for old in previous.dropFirst() { try? FileManager.default.removeItem(at: old) }
                let html = data!
                DispatchQueue.main.async {
                    guard let self = self, let webview = webview, self.generation == token else { completion(false); return }
                    self.selected = server
                    self.manifest = manifest
                    self.isActive = true
                    self.healthy = false
                    self.loadingSupplied = true
                    if force {
                        UserDefaults.standard.removeObject(forKey: self.disabledKey(server))
                        UserDefaults.standard.removeObject(forKey: self.failedKey(server))
                    }
                    let response = HTTPURLResponse(url: server, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "frame-ancestors 'none';"])!
                    webview.loadSimulatedRequest(URLRequest(url: server), response: response, responseData: html)
                    self.writeDiagnostics()
                    let check = DispatchWorkItem { [weak self] in
                        guard let self = self, self.generation == token, self.isActive, !self.healthy,
                              UIApplication.shared.applicationState == .active else { return }
                        UserDefaults.standard.set(manifest.buildId, forKey: self.failedKey(server))
                        self.useServerFrontend()
                    }
                    self.healthCheck = check
                    DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: check)
                    completion(true)
                }
            } catch {
                NSLog("[Lumiverse] Native cache unavailable: %@", String(describing: error))
                DispatchQueue.main.async { completion(false) }
            }
        }
    }

    func reload() -> Bool {
        guard isActive, let url = webview?.url, NativeBridge.origin(url) == NativeBridge.origin(selected), !url.path.hasPrefix("/api/") else { return false }
        load(server: url) { [weak self] loaded in if !loaded { self?.useServerFrontend() } }
        return true
    }

    func useServerFrontend() {
        healthCheck?.cancel()
        generation = UUID()
        isActive = false
        healthy = false
        writeDiagnostics()
        guard let url = selected else { return }
        UserDefaults.standard.set(true, forKey: disabledKey(url))
        webview?.load(URLRequest(url: url))
    }

    private enum CacheError: Error { case invalidBundle }
}
