import Foundation

/// Browser URL.origin omits default ports; native URL checks use an explicit port.
enum NativeServerOrigin {
    static func canonical(_ url: URL?) -> String? {
        guard let url = url, let scheme = url.scheme?.lowercased(), ["https", "http"].contains(scheme),
              let host = url.host?.lowercased(), host != "tauri.localhost" else { return nil }
        let port = url.port ?? (scheme == "https" ? 443 : 80)
        return "\(scheme)://\(host):\(port)"
    }

    static func matches(_ browserOrigin: String, _ nativeOrigin: String?) -> Bool {
        guard let expected = nativeOrigin, let actual = canonical(URL(string: browserOrigin)) else { return false }
        return actual == expected
    }
}
