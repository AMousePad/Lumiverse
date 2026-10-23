import Foundation

private struct Reply {
    var status = 200
    var headers = ["Content-Type": "application/json"]
    var chunks: [Data] = []
    var error: URLError?
    var redirect: URL?

    static func config(_ body: String = "{\"safeThemeMode\":false}") -> Reply {
        Reply(headers: ["Content-Type": "application/json", "Set-Cookie": "probe_cookie=secret; Path=/"],
              chunks: [Data(body.utf8)])
    }
    static let frontend = Reply(headers: ["Content-Type": "text/html; charset=utf-8"])
}

private final class FixtureProtocol: URLProtocol {
    static let lock = NSLock()
    static var replies: [Reply] = []
    static var requests: [URLRequest] = []
    static func reset(_ replies: [Reply]) {
        lock.lock()
        defer { lock.unlock() }
        Self.replies = replies
        requests = []
    }
    static func capturedRequests() -> [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return requests
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        Self.lock.lock()
        precondition(!Self.replies.isEmpty, "Unexpected request: \(request)")
        let reply = Self.replies.removeFirst()
        Self.requests.append(request)
        Self.lock.unlock()
        precondition(request.value(forHTTPHeaderField: "Cookie") == nil, "The probe sent cookies")
        precondition(request.value(forHTTPHeaderField: "Authorization") == nil, "The probe sent credentials")
        if let error = reply.error { client?.urlProtocol(self, didFailWithError: error); return }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status,
                                      httpVersion: "HTTP/1.1", headerFields: reply.headers)!
        if let redirect = reply.redirect {
            client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: redirect), redirectResponse: response)
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        for chunk in reply.chunks { client?.urlProtocol(self, didLoad: chunk) }
        client?.urlProtocolDidFinishLoading(self)
    }
}

@main
struct ServerProbeRegression {
    private static func check(_ name: String, _ replies: [Reply], succeeds: Bool, requests: Int,
                      message: String? = nil) async {
        FixtureProtocol.reset(replies)
        let configuration = URLSessionConfiguration.default
        configuration.protocolClasses = [FixtureProtocol.self]
        let result: Result<Void, Error> = await withCheckedContinuation { continuation in
            NativeServerProbe.check(server: URL(string: "https://probe.invalid:8443/")!, configuration: configuration) {
                continuation.resume(returning: $0)
            }
        }
        switch result {
        case .success: precondition(succeeds, "\(name): unexpectedly succeeded")
        case .failure(let error):
            precondition(!succeeds, "\(name): \(error)")
            if let message = message { precondition(error.localizedDescription.contains(message), "\(name): \(error)") }
        }
        let captured = FixtureProtocol.capturedRequests()
        precondition(captured.count == requests, "\(name): wrong request count")
        precondition(captured[0].httpMethod == "GET" && captured[0].url?.path == "/api/v1/runtime-config")
        precondition(captured[0].url?.port == 8443 && captured[0].value(forHTTPHeaderField: "Accept") == "application/json")
        if requests == 2 { precondition(captured[1].httpMethod == "HEAD" && captured[1].url?.path == "/") }
        print("PASS \(name)")
    }

    static func main() async {
        let cookie = HTTPCookie(properties: [.domain: "probe.invalid", .path: "/", .name: "session", .value: "secret"])!
        HTTPCookieStorage.shared.setCookie(cookie)
        defer { HTTPCookieStorage.shared.deleteCookie(cookie) }
        await check("valid configuration without cookies or credentials", [.config(), .frontend], succeeds: true, requests: 2)
        await check("true configuration", [.config("{\"safeThemeMode\":true}"), .frontend], succeeds: true, requests: 2)
        for value in ["{}", "{\"safeThemeMode\":\"false\"}", "{\"safeThemeMode\":1}", "<html>Proxy login</html>"] {
            await check("invalid configuration \(value)", [.config(value)], succeeds: false, requests: 1, message: "compatible Lumiverse server")
        }
        await check("missing frontend", [.config(), Reply()], succeeds: false, requests: 2, message: "serve the Lumiverse frontend")
        await check("startup HTTP error", [Reply(status: 503)], succeeds: false, requests: 1, message: "HTTP 503")
        await check("frontend HTTP error", [.config(), Reply(status: 404)], succeeds: false, requests: 2, message: "HTTP 404")
        await check("declared oversized response", [Reply(headers: ["Content-Length": "32768"])], succeeds: false,
                    requests: 1, message: "unexpected startup response")
        await check("chunked oversized response", [Reply(chunks: [Data(repeating: 32, count: 16_384), Data([32])])],
                    succeeds: false, requests: 1, message: "unexpected startup response")
        await check("network timeout", [Reply(error: URLError(.timedOut))], succeeds: false, requests: 1, message: "Could not connect")
        await check("certificate error", [Reply(error: URLError(.serverCertificateUntrusted))], succeeds: false, requests: 1, message: "Could not connect")
        await check("startup redirect", [Reply(status: 302, headers: ["Location": "https://other.invalid/"],
                    redirect: URL(string: "https://other.invalid/"))], succeeds: false, requests: 1, message: "redirected")
        await check("frontend redirect", [.config(), Reply(status: 302, headers: ["Location": "https://other.invalid/"],
                    redirect: URL(string: "https://other.invalid/"))], succeeds: false, requests: 2, message: "redirected")
    }
}
