import Foundation

@main
struct ServerOriginRegression {
    static func main() {
        // Activity enrollment uses browser origins, while configure stores the
        // native canonical origin. These must match after avatar prefetch.
        for origin in ["https://lumiverse.example", "http://lumiverse.example", "https://lumiverse.example:8443", "http://127.0.0.1:18763"] {
            precondition(NativeServerOrigin.matches(origin, NativeServerOrigin.canonical(URL(string: origin))), origin)
        }
        precondition(NativeServerOrigin.matches("https://lumiverse.example", "https://lumiverse.example:443"))
        precondition(NativeServerOrigin.matches("http://lumiverse.example", "http://lumiverse.example:80"))
        precondition(!NativeServerOrigin.matches("https://other.example", "https://lumiverse.example:443"))
        precondition(!NativeServerOrigin.matches("http://lumiverse.example", "https://lumiverse.example:443"))
        precondition(!NativeServerOrigin.matches("https://lumiverse.example:8443", "https://lumiverse.example:443"))
        precondition(!NativeServerOrigin.matches("https://lumiverse.example", nil))
        precondition(!NativeServerOrigin.matches("file:///tmp/test", "https://lumiverse.example:443"))
        precondition(NativeServerOrigin.canonical(URL(string: "https://tauri.localhost")) == nil)
    }
}
