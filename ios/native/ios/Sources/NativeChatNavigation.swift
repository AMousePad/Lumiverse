import Foundation

enum NativeChatNavigation {
    /// A notification for the displayed chat should only foreground the app.
    /// Keep its current query, scroll position, draft, and in-flight generation.
    static func isCurrentChat(_ target: URL, in current: URL?) -> Bool {
        guard let current = current, let origin = NativeServerOrigin.canonical(target),
              origin == NativeServerOrigin.canonical(current), target.query == nil, target.fragment == nil,
              target.path.range(of: "^/chat/[A-Za-z0-9_-]{1,128}/?$", options: .regularExpression) != nil else { return false }
        return current.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            == target.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}
