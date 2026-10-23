import Foundation

@main struct NotificationEncryptionCheck {
    static func main() throws {
        let input = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [String: Any]
        let envelope = input["envelope"] as! [String: Any], key = Data(base64Encoded: input["key"] as! String)!
        let result = try NotificationSecurity.openEnvelope(envelope, key: key, bundleId: "chat.lumiverse.ios", environment: "production")
        precondition(result["serverOrigin"] as? String == "https://private.example")
        let alert = (result["aps"] as! [String: Any])["alert"] as! [String: String]
        precondition(alert["title"] == "Private name" && alert["body"] == "Private message 🦊")
        for (bundle, environment) in [("another.app", "production"), ("chat.lumiverse.ios", "development")] {
            do { _ = try NotificationSecurity.openEnvelope(envelope, key: key, bundleId: bundle, environment: environment); fatalError("Expected AAD rejection") }
            catch { }
        }
        var tampered = envelope
        tampered["tag"] = Data(repeating: 0, count: 16).base64EncodedString()
        do { _ = try NotificationSecurity.openEnvelope(tampered, key: key, bundleId: "chat.lumiverse.ios", environment: "production"); fatalError("Expected tag rejection") }
        catch { }
        precondition(NotificationSecurity.browserOrigin(URL(string: "https://private.example:443/chat/1")) == "https://private.example")
        print("PASS: backend AES-GCM decrypts in Apple CryptoKit; wrong app/environment and tampering are rejected.")
    }
}
