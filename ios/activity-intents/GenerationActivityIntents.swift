import AppIntents
import Foundation

// Compiled directly into the application and widget so App Intents metadata is
// discoverable even though the native WebView plugin is linked through Rust.
// LiveActivityIntent executes in the host process and can use its Keychain.
@available(iOS 17.0, *)
struct StopGenerationIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop response"
    static var isDiscoverable = false
    static var openAppWhenRun = false

    @Parameter(title: "Generation") var generationId: String

    init() {}
    init(generationId: String) { self.generationId = generationId }

    func perform() async throws -> some IntentResult {
        #if !LUMIVERSE_ACTIVITY_EXTENSION
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            LumiverseActivityActions.stopGeneration(generationId) { error in
                if let error = error { continuation.resume(throwing: error) }
                else { continuation.resume() }
            }
        }
        #endif
        return .result()
    }
}

@available(iOS 17.0, *)
struct HideGenerationActivityIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Hide activity"
    static var description = IntentDescription("Dismiss this Live Activity. The response continues generating.")
    static var isDiscoverable = false
    static var openAppWhenRun = false

    @Parameter(title: "Generation") var generationId: String

    init() {}
    init(generationId: String) { self.generationId = generationId }

    func perform() async throws -> some IntentResult {
        #if !LUMIVERSE_ACTIVITY_EXTENSION
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            LumiverseActivityActions.hideGeneration(generationId) { continuation.resume() }
        }
        #endif
        return .result()
    }
}
