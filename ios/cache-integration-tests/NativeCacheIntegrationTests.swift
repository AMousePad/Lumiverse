import XCTest

/// Runs against the actual Tauri application, with a disposable loopback server.
final class NativeCacheIntegrationTests: XCTestCase {
    private func setOffline(_ offline: Bool) throws {
        let done = expectation(description: "Set backend availability")
        var failure: Error?
        URLSession.shared.dataTask(with: URL(string: "http://127.0.0.1:18765/__offline?value=\(offline ? 1 : 0)")!) { _, _, error in
            failure = error
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 5)
        if let failure = failure { throw failure }
    }

    private func showControls(_ app: XCUIApplication) {
        app.webViews.firstMatch.pinch(withScale: 1.05, velocity: 0.025)
        XCTAssertTrue(app.buttons["Reload"].waitForExistence(timeout: 5))
    }

    private func assertCachedLogin(_ app: XCUIApplication) {
        XCTAssertTrue(app.webViews.secureTextFields.firstMatch.waitForExistence(timeout: 20))
        XCTAssertFalse(app.webViews.staticTexts["Server frontend fixture"].exists)
    }

    func testRealWrapperCacheRestoreReloadAndFallback() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "chat.lumiverse.ios")
        try setOffline(false)
        defer { try? setOffline(false) }
        app.launch()
        let field = app.webViews.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        field.tap()
        field.typeText("http://127.0.0.1:18765")
        app.webViews.switches["Allow insecure HTTP for this server"].tap()
        app.webViews.buttons["Connect"].tap()
        assertCachedLogin(app)

        showControls(app)
        XCTAssertTrue(app.buttons["Use server frontend"].exists)
        app.buttons["Reload"].tap()
        assertCachedLogin(app)

        app.terminate()
        try setOffline(true)
        app.launch()
        assertCachedLogin(app)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Actual wrapper restored native cache"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        XCTAssertFalse(app.webViews.buttons["Connect"].exists)

        try setOffline(false)
        showControls(app)
        app.buttons["Use server frontend"].tap()
        XCTAssertTrue(app.webViews.staticTexts["Server frontend fixture"].waitForExistence(timeout: 15))
        showControls(app)
        XCTAssertTrue(app.buttons["Use native cached interface"].exists)
        app.buttons["Use native cached interface"].tap()
        assertCachedLogin(app)

        // A second cold launch leaves the app in its cached interface so the
        // host runner can verify the native disk health report as well.
        app.terminate()
        app.launch()
        assertCachedLogin(app)
    }
}
