import UIKit

/// Covers the entire ActivityKit-token-to-server handoff, including the time
/// before pushTokenUpdates emits. Starting this only inside an upload is too late.
@MainActor
final class LiveActivityHandoff {
    typealias Begin = @MainActor (@escaping @MainActor @Sendable () -> Void) -> UIBackgroundTaskIdentifier
    private let beginTask: Begin
    private let endTask: @MainActor (UIBackgroundTaskIdentifier) -> Void
    private var tasks: [String: (attempt: UUID, token: UIBackgroundTaskIdentifier)] = [:]

    init(begin: @escaping Begin = { UIApplication.shared.beginBackgroundTask(withName: "Live Activity handoff", expirationHandler: $0) },
         end: @escaping @MainActor (UIBackgroundTaskIdentifier) -> Void = { UIApplication.shared.endBackgroundTask($0) }) {
        beginTask = begin
        endTask = end
    }

    @discardableResult
    func begin(_ id: String, onExpiration: @escaping @MainActor () -> Void) -> Bool {
        guard tasks[id] == nil else { return true }
        let attempt = UUID()
        let token = beginTask { [weak self] in
            guard let self = self, self.tasks[id]?.attempt == attempt else { return }
            self.end(id)
            onExpiration()
        }
        guard token != .invalid else { return false }
        tasks[id] = (attempt, token)
        return true
    }

    func end(_ id: String) {
        guard let task = tasks.removeValue(forKey: id) else { return }
        endTask(task.token)
    }
}
