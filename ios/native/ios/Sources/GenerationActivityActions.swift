import Foundation

/// Objective-C keeps the app's directly compiled intents connected to the same
/// activity manager as the Rust-linked Swift plugin.
@available(iOS 17.0, *)
@objc(LumiverseActivityActions)
public final class GenerationActivityActions: NSObject {
    @objc(stopGeneration:completion:)
    public static func stopGeneration(_ generationId: String, completion: @escaping (NSError?) -> Void) {
        Task { @MainActor in
            do { try await IOSLiveActivities.shared.stopGeneration(generationId); completion(nil) }
            catch { completion(error as NSError) }
        }
    }
    @objc(hideGeneration:completion:)
    public static func hideGeneration(_ generationId: String, completion: @escaping () -> Void) {
        Task { @MainActor in
            await IOSLiveActivities.shared.hideGeneration(generationId)
            completion()
        }
    }
}
