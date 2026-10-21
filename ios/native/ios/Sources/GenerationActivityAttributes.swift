import ActivityKit
import Foundation

// Compiled into both the host plugin and WidgetKit extension. Keep ContentState
// in sync with activityState() in ios-live-activities.service.ts.
@available(iOS 16.1, *)
struct GenerationActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let phase: String
        let label: String
        var terminal: Bool { ["completed", "stopped", "error", "interrupted"].contains(phase) }
        var symbol: String {
            switch phase {
            case "completed": return "checkmark.circle.fill"
            case "error", "interrupted": return "exclamationmark.circle.fill"
            case "stopped": return "stop.circle.fill"
            case "inputNeeded": return "hand.raised.fill"
            case "reasoning": return "ellipsis.bubble.fill"
            case "streaming": return "text.line.first.and.arrowtriangle.forward"
            case "waiting": return "hourglass"
            case "council": return "person.2.fill"
            default: return "sparkles"
            }
        }
    }
    let generationId: String
    let chatId: String
    let serverOrigin: String
    let accountId: String
    let characterName: String
    let startedAt: Double
    var avatarKey: String? = nil

    var tapURL: URL? {
        var url = URLComponents()
        url.scheme = "lumiverse"
        url.host = "activity"
        url.path = "/" + generationId
        // Only an activity ID is carried in the link. Native code resolves its
        // server/account/chat from the locally retained enrollment.
        return url.url
    }
}
