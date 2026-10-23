import XCTest

final class ClientSmokeTests: XCTestCase {
    func testConnectionPersistenceAndNativeControls() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "chat.lumiverse.ios")
        app.launch()
        // Run the same controls on the compact SE Lock Screen and the Island
        // on the taller iPhone simulator used by this smoke suite.
        let field = app.webViews.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        let showsIsland = app.windows.firstMatch.frame.height > 700
        field.tap()
        // A connected Mac keyboard can hide the simulator's software keyboard.
        // On a fresh simulator, the launch animation can also consume this tap.
        if !app.keyboards.firstMatch.waitForExistence(timeout: 2) { field.tap() }
        field.typeText("http://127.0.0.1:18763")
        app.webViews.buttons["Connect"].tap()
        XCTAssertTrue(app.webViews.staticTexts["Remote Lumiverse"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.staticTexts["Native commands blocked"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.webViews.staticTexts["iOS mobile identity verified"].exists)
        XCTAssertTrue(app.webViews.staticTexts["Native permissions verified"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.webViews.staticTexts["Native audio verified"].waitForExistence(timeout: 10))
        app.webViews.buttons["Test Live Activity"].tap()
        XCTAssertTrue(app.webViews.staticTexts["Live Activity background start pending"].waitForExistence(timeout: 15))
        XCUIDevice.shared.press(.home)
        let release = expectation(description: "Release avatar download while app is backgrounded")
        URLSession.shared.dataTask(with: URL(string: "http://127.0.0.1:18763/release-resume-avatar")!) { _, _, error in
            XCTAssertNil(error)
            release.fulfill()
        }.resume()
        wait(for: [release], timeout: 5)
        Thread.sleep(forTimeInterval: 0.5)
        app.activate()
        let activitySpringboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        func continueActivityCheck(_ label: String) {
            let button = app.webViews.buttons[label]
            XCTAssertTrue(button.waitForExistence(timeout: 5))
            button.tap()
            // SpringBoard's return animation can consume the first WebView tap.
            if !button.waitForNonExistence(timeout: 1) { button.tap() }
        }
        for (stage, status, next) in [("preparing", "Preparing response", "Continue after Prepare"), ("thinking", "Thinking", "Continue after Think")] {
            XCTAssertTrue(app.webViews.staticTexts["Live Activity \(stage) preview ready"].waitForExistence(timeout: 15), app.webViews.debugDescription)
            XCUIDevice.shared.press(.home)
            activitySpringboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.01))
                .press(forDuration: 0.1, thenDragTo: activitySpringboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.8)))
            XCTAssertTrue(activitySpringboard.staticTexts[status].waitForExistence(timeout: 10), activitySpringboard.debugDescription)
            let allow = activitySpringboard.buttons["Allow"].firstMatch
            if allow.exists { allow.tap(); Thread.sleep(forTimeInterval: 1) }
            let snapshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            snapshot.name = "Lumiverse \(stage) avatar accent"
            snapshot.lifetime = .keepAlways
            add(snapshot)
            XCUIDevice.shared.press(.home)
            app.activate()
            continueActivityCheck(next)
        }
        XCTAssertTrue(app.webViews.staticTexts["Live Activity preview ready"].waitForExistence(timeout: 15), app.webViews.debugDescription)
        XCUIDevice.shared.press(.home)
        activitySpringboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.01))
            .press(forDuration: 0.1, thenDragTo: activitySpringboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.8)))
        XCTAssertTrue(activitySpringboard.staticTexts["Writing response"].waitForExistence(timeout: 10), activitySpringboard.debugDescription)
        // Fresh disposable simulator installs show the one-time ActivityKit
        // permission card. Dismiss it before taking presentation snapshots.
        let allowActivity = activitySpringboard.buttons["Allow"].firstMatch
        if allowActivity.exists { allowActivity.tap(); Thread.sleep(forTimeInterval: 1) }
        let activityScreenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        activityScreenshot.name = "Lumiverse Lock Screen activity"
        activityScreenshot.lifetime = .keepAlways
        add(activityScreenshot)
        if showsIsland {
            XCUIDevice.shared.press(.home)
            XCTAssertTrue(activitySpringboard.icons["Lumiverse"].waitForExistence(timeout: 5))
            Thread.sleep(forTimeInterval: 1)
            let islandScreenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            islandScreenshot.name = "Lumiverse compact Dynamic Island"
            islandScreenshot.lifetime = .keepAlways
            add(islandScreenshot)
            activitySpringboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.035)).press(forDuration: 1)
            XCTAssertTrue(activitySpringboard.staticTexts["Writing response"].waitForExistence(timeout: 5))
            Thread.sleep(forTimeInterval: 0.5)
            let expandedScreenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            expandedScreenshot.name = "Lumiverse expanded Dynamic Island"
            expandedScreenshot.lifetime = .keepAlways
            add(expandedScreenshot)
        }
        let stopResponse = activitySpringboard.buttons["Stop response"].firstMatch
        XCTAssertTrue(stopResponse.waitForExistence(timeout: 5), activitySpringboard.debugDescription)
        stopResponse.tap()
        XCTAssertTrue(stopResponse.waitForNonExistence(timeout: 10), activitySpringboard.debugDescription)
        XCTAssertNotEqual(app.state, .runningForeground, "Stop must run without opening Lumiverse")
        if !showsIsland {
            // Let the stopped card finish its dismissal before presenting a
            // second activity on the SE's shorter notification list.
            XCTAssertTrue(activitySpringboard.staticTexts["Generation stopped"].waitForNonExistence(timeout: 20))
        }
        XCUIDevice.shared.press(.home)
        app.activate()
        continueActivityCheck("Continue after Stop")
        XCTAssertTrue(app.webViews.staticTexts["Live Activity hide preview ready"].waitForExistence(timeout: 15), app.webViews.debugDescription)
        XCUIDevice.shared.press(.home)
        activitySpringboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.01))
            .press(forDuration: 0.1, thenDragTo: activitySpringboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.8)))
        let hideActivity = activitySpringboard.buttons["Hide activity"].firstMatch
        XCTAssertTrue(hideActivity.waitForExistence(timeout: 5), activitySpringboard.debugDescription)
        hideActivity.tap()
        XCTAssertTrue(hideActivity.waitForNonExistence(timeout: 10))
        XCTAssertNotEqual(app.state, .runningForeground, "Hide must run without opening Lumiverse")
        XCUIDevice.shared.press(.home)
        app.activate()
        continueActivityCheck("Continue after Hide")
        XCTAssertTrue(app.webViews.staticTexts["Live Activity completed preview ready"].waitForExistence(timeout: 15), app.webViews.debugDescription)
        XCUIDevice.shared.press(.home)
        activitySpringboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.01))
            .press(forDuration: 0.1, thenDragTo: activitySpringboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.8)))
        XCTAssertTrue(activitySpringboard.staticTexts["Response ready"].waitForExistence(timeout: 10), activitySpringboard.debugDescription)
        XCTAssertTrue(activitySpringboard.links["Read response"].exists || activitySpringboard.buttons["Read response"].exists)
        let alwaysAllow = activitySpringboard.buttons["Always Allow"].firstMatch
        if alwaysAllow.exists { alwaysAllow.tap(); Thread.sleep(forTimeInterval: 1) }
        let readyScreenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        readyScreenshot.name = "Lumiverse response ready"
        readyScreenshot.lifetime = .keepAlways
        add(readyScreenshot)
        XCUIDevice.shared.press(.home)
        app.activate()
        continueActivityCheck("Continue after Ready")
        XCTAssertTrue(app.webViews.staticTexts["Live Activity verified"].waitForExistence(timeout: 15), app.webViews.debugDescription)
        for label in ["Export blob", "Export blob", "Export from server"] {
            app.webViews.buttons[label].tap()
            XCTAssertTrue(app.alerts["Export saved"].waitForExistence(timeout: 15))
            app.alerts["Export saved"].buttons["OK"].tap()
        }
        app.webViews.buttons["Try native dictation"].tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 10))
        let deny = alert.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", "Don")).firstMatch
        XCTAssertTrue(deny.exists)
        deny.tap()
        XCTAssertTrue(app.webViews.staticTexts["Speech permission denial handled"].waitForExistence(timeout: 10))

        XCTAssertFalse(app.buttons["lumiverse.native.actions"].exists)
        XCTAssertFalse(app.buttons["lumiverse.accessibility.actions"].exists)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6)).press(forDuration: 0.9)
        XCTAssertFalse(app.buttons["Share this page"].exists)
        // XCTest has no two-finger hold API. A tiny, slow pinch keeps both
        // touches within the recognizer's movement tolerance for over 650 ms.
        app.webViews.firstMatch.pinch(withScale: 1.05, velocity: 0.025)
        XCTAssertTrue(app.buttons["Share this page"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Check animation frame rate"].exists)
        XCTAssertTrue(app.buttons["App permissions"].exists)
        let controlsScreenshot = XCTAttachment(screenshot: app.screenshot())
        controlsScreenshot.name = "Lumiverse native controls"
        controlsScreenshot.lifetime = .keepAlways
        add(controlsScreenshot)
        app.buttons["Share this page"].tap()
        let copy = app.descendants(matching: .any).matching(identifier: "Copy").firstMatch
        XCTAssertTrue(copy.waitForExistence(timeout: 10))
        copy.tap()

        app.terminate()
        app.launch()
        XCTAssertTrue(app.webViews.staticTexts["Remote Lumiverse"].waitForExistence(timeout: 20))
        app.webViews.firstMatch.pinch(withScale: 1.05, velocity: 0.025)
        app.buttons["Change server"].tap()
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        XCTAssertEqual(field.value as? String, "http://127.0.0.1:18763/")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Lumiverse connection screen"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
