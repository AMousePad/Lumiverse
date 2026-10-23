import Foundation

@main
struct ChatNavigationRegression {
    static func main() {
        let target = URL(string: "https://lumiverse.example/chat/chat-1")!
        for current in ["https://lumiverse.example/chat/chat-1", "https://lumiverse.example:443/chat/chat-1?panel=details#message-2", "https://lumiverse.example/chat/chat-1/"] {
            precondition(NativeChatNavigation.isCurrentChat(target, in: URL(string: current)), current)
        }
        for current in ["https://lumiverse.example/", "https://lumiverse.example/chat/chat-2", "https://other.example/chat/chat-1", "http://lumiverse.example/chat/chat-1", "https://lumiverse.example:8443/chat/chat-1"] {
            precondition(!NativeChatNavigation.isCurrentChat(target, in: URL(string: current)), current)
        }
        precondition(!NativeChatNavigation.isCurrentChat(target, in: nil))
        for target in ["https://lumiverse.example/chat/chat-1?message=2", "https://lumiverse.example/chat/chat-1#message-2", "https://lumiverse.example/"] {
            precondition(!NativeChatNavigation.isCurrentChat(URL(string: target)!, in: URL(string: target)))
        }
    }
}
