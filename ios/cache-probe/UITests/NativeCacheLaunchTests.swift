import XCTest

final class NativeCacheLaunchTests: XCTestCase {
    func testCachedProductionShellSurvivesProcessTermination() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "chat.lumiverse.cacheprobe")
        app.launchArguments = ["--stage-cached-shell"]
        app.launch()
        let status = app.staticTexts["cache-probe-status"]
        let ready = NSPredicate(format: "label == %@", "Disk shell ready; session cookie restored")
        expectation(for: ready, evaluatedWith: status)
        waitForExpectations(timeout: 35)
        app.terminate()

        // This origin has no server. The second process must read the disk
        // document and persistent WebKit cookie without restaging the bundle.
        app.launchArguments = ["--open-cached-shell"]
        app.launch()
        expectation(for: ready, evaluatedWith: status)
        waitForExpectations(timeout: 35)
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = "Cold-process native disk restore without a server"
        image.lifetime = .keepAlways
        add(image)
    }
}
