import UIKit

// A separate test host keeps feasibility experiments out of the distributed IPA.
@main
final class CacheProbeApp: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
        didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        let arguments = ProcessInfo.processInfo.arguments
        window.rootViewController = arguments.contains("--open-cached-shell") || arguments.contains("--stage-cached-shell")
            ? CachedShellProbeController(stage: arguments.contains("--stage-cached-shell")) : UIViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
