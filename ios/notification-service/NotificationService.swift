import ImageIO
import Intents
import UIKit
import UserNotifications

/// APNs wakes this extension even when the WebView/app is suspended.
final class NotificationService: UNNotificationServiceExtension {
    private var handler: ((UNNotificationContent) -> Void)?
    private var original: UNNotificationContent?
    private var avatarDownload: AvatarDownload?

    override func didReceive(_ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        DispatchQueue.main.async { self.receive(request, handler: contentHandler) }
    }

    private func receive(_ request: UNNotificationRequest, handler: @escaping (UNNotificationContent) -> Void) {
        self.handler = handler
        original = request.content
        if let challenge = request.content.userInfo["relayChallenge"] as? [String: Any] {
            Task { await NotificationSecurity.confirm(challenge); await MainActor.run { self.finish() } }
            return
        }
        var content = request.content
        if let encrypted = content.userInfo["encrypted"] as? [String: Any] {
            let bundleId = Bundle.main.object(forInfoDictionaryKey: "LumiverseNotificationBundleID") as? String ?? "chat.lumiverse.ios"
            var clear: [String: Any]?
            for environment in ["production", "development"] {
                if let result = try? NotificationSecurity.decrypt(encrypted, bundleId: bundleId, environment: environment) { clear = result; break }
            }
            guard let info = clear, let aps = info["aps"] as? [String: Any], let alert = aps["alert"] as? [String: String],
                  let title = alert["title"], let body = alert["body"],
                  let updated = content.mutableCopy() as? UNMutableNotificationContent else { finish(); return }
            updated.title = title; updated.body = body; updated.userInfo = info
            if let sound = aps["sound"] as? String, ["default", "lumiverse-complete.wav"].contains(sound) {
                updated.sound = sound == "default" ? .default : UNNotificationSound(named: UNNotificationSoundName(rawValue: sound))
            }
            if let thread = aps["thread-id"] as? String, Self.validId(thread) { updated.threadIdentifier = thread }
            content = updated; original = updated
        }
        let info = content.userInfo
        guard let server = info["serverOrigin"] as? String, let origin = URL(string: server),
              ["https", "http"].contains(origin.scheme?.lowercased() ?? ""), origin.host != nil,
              origin.user == nil, origin.password == nil,
              let chatId = info["chatId"] as? String, Self.validId(chatId),
              let sender = info["communication"] as? [String: String],
              let senderId = sender["senderId"], Self.validId(senderId),
              let senderName = sender["senderName"], !senderName.isEmpty, senderName.utf8.count <= 256,
              let path = sender["avatarPath"], path.hasPrefix("/api/ios-notifications/v1/avatar/"),
              !path.contains("\\"), let url = URL(string: path, relativeTo: origin)?.absoluteURL,
              url.scheme == origin.scheme, url.host == origin.host, url.port == origin.port,
              url.user == nil, url.password == nil, url.fragment == nil else { finish(); return }
        avatarDownload = AvatarDownload(url: url) { [weak self] data in
            guard let self = self, self.handler != nil, let data = data,
                  let source = CGImageSourceCreateWithData(data as CFData, nil),
                  let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceThumbnailMaxPixelSize: 128,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                  ] as CFDictionary), let png = UIImage(cgImage: image).pngData() else { self?.finish(); return }
            let avatar = INImage(imageData: png)
            // Scope identifiers to this server; character IDs aren't phone/email
            // contacts and should never be suggested as address-book matches.
            let identifier = "\(server)|character:\(senderId)"
            let person = INPerson(personHandle: INPersonHandle(value: identifier, type: .unknown),
                nameComponents: nil, displayName: senderName, image: avatar,
                contactIdentifier: nil, customIdentifier: identifier, aliases: nil, suggestionType: .none)
            let intent = INSendMessageIntent(recipients: nil, outgoingMessageType: .outgoingMessageText,
                content: content.body, speakableGroupName: nil,
                conversationIdentifier: "\(server)|chat:\(chatId)", serviceName: "Lumiverse", sender: person, attachments: nil)
            intent.setImage(avatar, forParameterNamed: \.sender)
            let interaction = INInteraction(intent: intent, response: nil)
            interaction.direction = .incoming
            interaction.donate { [weak self] error in
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    guard error == nil else { self.finish(); return }
                    self.finish(content: try? content.updating(from: intent))
                }
            }
        }
        avatarDownload?.start()
    }

    override func serviceExtensionTimeWillExpire() {
        DispatchQueue.main.async { self.finish() }
    }

    private static func validId(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil
    }

    private func finish(content: UNNotificationContent? = nil) {
        guard let handler = handler, let original = original else { return }
        self.handler = nil
        avatarDownload?.cancel()
        avatarDownload = nil
        handler(content ?? original)
    }
}

/// No app cookies or credentials, redirects, disk cache, or unbounded image data.
private final class AvatarDownload: NSObject, URLSessionDataDelegate {
    private let url: URL
    private var session: URLSession?
    private var data = Data()
    private var completion: ((Data?) -> Void)?
    private let limit = 256 * 1024

    init(url: URL, completion: @escaping (Data?) -> Void) { self.url = url; self.completion = completion }

    func start() {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 10
        session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        session?.dataTask(with: url).resume()
    }

    func cancel() { completion = nil; session?.invalidateAndCancel(); session = nil }

    private func finish(_ result: Data?) {
        let callback = completion
        completion = nil
        session?.invalidateAndCancel()
        session = nil
        callback?(result)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil); finish(nil) }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.mimeType == "image/jpeg", response.expectedContentLength <= Int64(limit) else {
            completionHandler(.cancel); finish(nil); return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard self.data.count + data.count <= limit else { finish(nil); return }
        self.data.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        finish(error == nil && !data.isEmpty ? data : nil)
    }
}
