import Foundation

@main struct WidgetChecks {
    static func main() throws {
        let enrollment = CharacterWidgetEnrollment(registrationId: "registration-123", accountId: "owner", serverOrigin: "https://example.com", expiresAt: 9e15, palette: CharacterWidgetPalette())
        let recent = CharacterWidgetItem(characterId: "lumi", name: "Lumi", chatId: "chat-1", updatedAt: 10)
        let favorite = CharacterWidgetItem(characterId: "nova", name: "Nova", chatId: nil, updatedAt: 10)
        let snapshot = CharacterWidgetSnapshot(version: 1, accountId: "owner", generatedAt: 10, recent: [recent], favorites: [favorite])
        precondition(snapshot.valid)
        func path(_ url: String) -> String? { CharacterWidgetLink.destination(url, enrollment: enrollment, snapshot: snapshot) }
        precondition(path(CharacterWidgetLink.url(enrollment: enrollment, item: recent, collection: "recent").absoluteString) == "/chat/chat-1")
        precondition(path("lumiverse://widget/registration-123/favorites/nova") == "/widget/character/nova")
        for url in ["lumiverse://widget/old-registration/recent/lumi", "lumiverse://widget/registration-123/recent/nova",
                    "lumiverse://widget/registration-123/favorites/lumi", "https://widget/registration-123/recent/lumi",
                    "lumiverse://widget/registration-123/recent/lumi?redirect=evil", "lumiverse://widget/registration-123/recent/lumi#fragment",
                    "lumiverse://user@widget/registration-123/recent/lumi", "lumiverse://widget:80/registration-123/recent/lumi",
                    "lumiverse://widget/registration-123/recent/%2e%2e"] { precondition(path(url) == nil, url) }
        let other = CharacterWidgetSnapshot(version: 1, accountId: "other", generatedAt: 10, recent: [recent], favorites: [])
        precondition(CharacterWidgetLink.destination("lumiverse://widget/registration-123/recent/lumi", enrollment: enrollment, snapshot: other) == nil)
        let hostile = CharacterWidgetItem(characterId: "lumi", name: "Lumi", chatId: "../outside", updatedAt: 10)
        precondition(!CharacterWidgetSnapshot(version: 1, accountId: "owner", generatedAt: 10, recent: [hostile], favorites: []).valid)
        precondition(!CharacterWidgetPalette(background: "url(evil)", foreground: "#ffffff", accent: "#000000").valid)
        let decoded = try JSONDecoder().decode(CharacterWidgetSnapshot.self, from: JSONEncoder().encode(snapshot))
        precondition(decoded.valid && decoded.favorites.first?.chatId == nil)
    }
}
