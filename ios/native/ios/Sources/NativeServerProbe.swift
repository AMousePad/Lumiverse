import Foundation

/// Validate a new server using Apple's networking and TLS implementation. The
/// private session never borrows WebKit cookies, cached responses, or credentials.
/// URLSession serializes delegate callbacks; finish invalidates its delegate cycle.
final class NativeServerProbe: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private struct RuntimeConfiguration: Decodable { let safeThemeMode: Bool }
    private struct Failure: LocalizedError { let errorDescription: String? }
    private let server: URL
    private var session: URLSession!
    private var completion: ((Result<Void, Error>) -> Void)?
    private var checkingFrontend = false
    private var bytes = Data()
    private let responseLimit = 16_384

    static func check(server: URL, configuration: URLSessionConfiguration = .ephemeral,
                      completion: @escaping (Result<Void, Error>) -> Void) {
        let probe = NativeServerProbe(server: server, completion: completion)
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 12
        configuration.timeoutIntervalForResource = 12
        configuration.waitsForConnectivity = false
        probe.session = URLSession(configuration: configuration, delegate: probe, delegateQueue: nil)
        probe.startRequest()
    }

    private init(server: URL, completion: @escaping (Result<Void, Error>) -> Void) {
        self.server = server
        self.completion = completion
    }

    private func startRequest() {
        let url = checkingFrontend ? server : server.appendingPathComponent("api/v1/runtime-config")
        var request = URLRequest(url: url)
        request.httpMethod = checkingFrontend ? "HEAD" : "GET"
        request.httpShouldHandleCookies = false
        if !checkingFrontend { request.setValue("application/json", forHTTPHeaderField: "Accept") }
        session.dataTask(with: request).resume()
    }

    private func finish(_ result: Result<Void, Error>) {
        guard let completion = completion else { return }
        self.completion = nil
        session.invalidateAndCancel()
        session = nil
        completion(result)
    }

    private func fail(_ message: String) { finish(.failure(Failure(errorDescription: message))) }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        fail("The server redirected its startup endpoint. Enter its final server address.")
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        // Preserve the system's TLS certificate checks; never supply login or
        // client-certificate credentials to this public startup check.
        completionHandler(challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust
            ? .performDefaultHandling : .cancelAuthenticationChallenge, nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard completion != nil else { completionHandler(.cancel); return }
        guard let response = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            fail("The server returned an unexpected startup response.")
            return
        }
        guard (200..<300).contains(response.statusCode) else {
            completionHandler(.cancel)
            fail((300..<400).contains(response.statusCode)
                ? "The server redirected its startup endpoint. Enter its final server address."
                : "The server's startup endpoint is unavailable (HTTP \(response.statusCode)).")
            return
        }
        if checkingFrontend {
            let mime = response.value(forHTTPHeaderField: "Content-Type")?.split(separator: ";").first?
                .trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard mime == "text/html" else {
                completionHandler(.cancel)
                fail("The server must serve the Lumiverse frontend at this address.")
                return
            }
        } else if response.expectedContentLength > responseLimit {
            completionHandler(.cancel)
            fail("The server returned an unexpected startup response.")
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard completion != nil, !checkingFrontend else { return }
        guard data.count <= responseLimit - bytes.count else {
            fail("The server returned an unexpected startup response.")
            return
        }
        bytes.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard completion != nil else { return }
        if let error = error { fail("Could not connect to the server: \(error.localizedDescription)"); return }
        if checkingFrontend { finish(.success(())); return }
        guard (try? JSONDecoder().decode(RuntimeConfiguration.self, from: bytes)) != nil else {
            fail("This address does not appear to be a compatible Lumiverse server.")
            return
        }
        bytes.removeAll()
        checkingFrontend = true
        startRequest()
    }
}
