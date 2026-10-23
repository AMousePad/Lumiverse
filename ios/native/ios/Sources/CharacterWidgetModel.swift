import Foundation

struct CharacterWidgetItem: Codable, Identifiable {
    var id: String { characterId }
    let characterId: String
    let name: String
    let chatId: String?
    let updatedAt: Double
    var imageKey: String?
}
struct CharacterWidgetSnapshot: Codable {
    let version: Int
    let accountId: String
    let generatedAt: Double
    var recent: [CharacterWidgetItem]
    var favorites: [CharacterWidgetItem]
    var valid: Bool {
        version == 1 && recent.count <= 16 && favorites.count <= 16 && (recent + favorites).allSatisfy {
            CharacterWidgetLink.identifier($0.characterId) && ($0.chatId == nil || CharacterWidgetLink.identifier($0.chatId!)) && $0.name.utf8.count <= 1024
        }
    }
}
struct CharacterWidgetPalette: Codable {
    var background = "#171321"
    var foreground = "#f5f0ff"
    var accent = "#bca6ff"
    static func color(_ value: String) -> Bool { value.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil }
    var valid: Bool { Self.color(background) && Self.color(foreground) && Self.color(accent) }
}
struct CharacterWidgetEnrollment: Codable {
    let registrationId: String
    let accountId: String
    let serverOrigin: String
    let expiresAt: Double
    var palette: CharacterWidgetPalette
}
enum CharacterWidgetLink {
    static func identifier(_ value: String) -> Bool { value.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil }
    static func url(enrollment: CharacterWidgetEnrollment, item: CharacterWidgetItem, collection: String) -> URL {
        URL(string: "lumiverse://widget/\(enrollment.registrationId)/\(collection)/\(item.characterId)")!
    }
    static func destination(_ raw: String, enrollment: CharacterWidgetEnrollment, snapshot: CharacterWidgetSnapshot) -> String? {
        guard let url = URLComponents(string: raw), url.scheme == "lumiverse", url.host == "widget",
              url.user == nil, url.password == nil, url.port == nil, url.query == nil, url.fragment == nil,
              snapshot.accountId == enrollment.accountId, snapshot.valid else { return nil }
        let parts = url.path.split(separator: "/").map(String.init)
        guard parts.count == 3, parts[0] == enrollment.registrationId,
              ["recent", "favorites"].contains(parts[1]), identifier(parts[2]) else { return nil }
        let items = parts[1] == "recent" ? snapshot.recent : snapshot.favorites
        guard let item = items.first(where: { $0.characterId == parts[2] }) else { return nil }
        return item.chatId.map { "/chat/" + $0 } ?? "/widget/character/" + item.characterId
    }
}
