import XCTest

final class HTTPConnectionTests: XCTestCase {
    func testHTTPConsentLoginChatAndRestore() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "chat.lumiverse.ios")
        app.launch()
        let server = app.webViews.textFields.firstMatch
        XCTAssertTrue(server.waitForExistence(timeout: 20))
        server.tap()
        if !app.keyboards.firstMatch.waitForExistence(timeout: 2) { server.tap() }
        server.typeText(httpTestOrigin)
        app.webViews.buttons["Connect"].tap()
        XCTAssertTrue(app.webViews.staticTexts["To connect over HTTP, enable Allow insecure HTTP for this server."].waitForExistence(timeout: 5))
        let consent = app.webViews.switches["Allow insecure HTTP for this server"]
        XCTAssertTrue(consent.exists, app.webViews.debugDescription)
        consent.tap()
        app.webViews.buttons["Connect"].tap()
        let username = app.webViews.textFields["Enter your username"]
        XCTAssertTrue(username.waitForExistence(timeout: 30), app.webViews.debugDescription)
        XCTAssertTrue(app.webViews.staticTexts["HTTP context: insecure"].exists)
        username.tap()
        if !app.keyboards.firstMatch.waitForExistence(timeout: 2) { username.tap() }
        username.typeText("httpsmoke")
        let password = app.webViews.secureTextFields.firstMatch
        password.tap(); password.typeText("http-smoke-password\n")
        XCTAssertTrue(username.waitForNonExistence(timeout: 20), app.webViews.debugDescription)
        let openChat = app.webViews.links["Open HTTP test chat"]
        XCTAssertTrue(openChat.waitForExistence(timeout: 15))
        openChat.tap()
        XCTAssertTrue(app.webViews.staticTexts["HTTP transport greeting"].waitForExistence(timeout: 20), app.webViews.debugDescription)
        app.webViews.buttons["Verify HTTP chat"].tap()
        XCTAssertTrue(app.webViews.staticTexts["HTTP chat, WebSocket, and native widgets verified"].waitForExistence(timeout: 30), app.webViews.debugDescription)
        let snapshot = XCTAttachment(screenshot: app.screenshot())
        snapshot.name = "HTTP backend authenticated chat"
        snapshot.lifetime = .keepAlways
        add(snapshot)
        app.terminate(); app.launch()
        XCTAssertTrue(app.webViews.links["Open HTTP test chat"].waitForExistence(timeout: 30))
        app.webViews.links["Open HTTP test chat"].tap()
        XCTAssertTrue(app.webViews.staticTexts["HTTP transport greeting"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.webViews.secureTextFields.firstMatch.exists)
    }
}
