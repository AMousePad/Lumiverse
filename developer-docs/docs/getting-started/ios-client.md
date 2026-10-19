# Native iOS client

The signed iOS wrapper connects to a remote Lumiverse server. The server serves
the frontend and continues generation while iOS suspends the app. UIKit scene
transitions restore WebSocket presence, stream focus, and generation buffers
when the app returns, including brief app switches.

On launch, the native launch screen and connection page share a plain dark
background. No logo or startup message appears while restoring the saved
address and reconnecting; the iOS frontend session check also stays visually
empty. Setup appears for a new installation, when
changing servers, or after a restore/connection failure. Failed reconnects keep
the saved address available for retry.

## Caching and the Home Screen PWA

The wrapper accepts user-configured HTTPS server origins without an app-bound
domain list. Ordinary builds use WebKit's persistent HTTP cache for cacheable
server responses and require an online connection probe before opening a server.

The opt-in `--native-cache-preview` build adds a native, origin-scoped frontend
store to the real wrapper. It ships the current frontend in the IPA, verifies
its SHA-256 before use, and supplies the document at the selected server's real
URL. Scripts, styles, fonts, and worker/worklet code load locally. Authentication,
API calls, WebSockets, uploads, and media continue through normal WebKit
networking with the server's existing cookies. A saved server can open its
cached interface without waiting for the native connection probe or runtime
configuration. New server addresses still require validation.

This is a device-testing preview. Frontend updates currently require a new IPA;
background server bundle downloads and managed image/media caching are not yet
implemented. Cached startup does not provide offline conversations or login,
and PWA performance parity has not been measured. The native store retains two
frontend generations per origin and excludes them from device backups. A local
boot acknowledgement detects failed bundles and falls back to the server UI.
Hold two fingers on the page to choose **Reload**, **Use server frontend**, or
**Use native cached interface**. The server-frontend preference is per origin.

The separate iOS Home Screen PWA uses a same-window SSO redirect for sign-in
and account linking. Completion returns to the app without closing its window;
provider errors stay visible with a return action. This frontend change does
not alter the native wrapper's selected-origin navigation policy.

The [native cache implementation plan](ios-native-cache-plan.md)
describes managed frontend/media caching, fast startup, updates, rollback,
authentication integration, and PWA performance comparisons. The preview above
implements an initial subset; the full release remains in progress. A separate
[native cache feasibility probe](ios-native-cache-probe.md) exercises production
frontend loading from disk, origin/cookie behavior, worker compatibility, and
cold-process restores independently of the wrapper integration tests.

## Build and install

On a Mac with Xcode, an enrolled Apple Developer signing team, and a provisioned
`chat.lumiverse.ios` App ID with Push Notifications enabled:

```sh
bun run build:ios-client --push-notifications
```

The helper preserves the configured signing team, verifies `aps-environment`,
and writes `dist/ios/lumiverse-ios-arm64-push.ipa`. Install on an unlocked,
paired iPhone using Xcode or `xcrun devicectl device install app`. The generated
archive's application is under
`ios/tauri/src-tauri/gen/apple/build/arm64/Lumiverse.xcarchive/Products/Applications/Lumiverse.app`.
The updated server frontend is also required for lifecycle recovery.

To build the integrated native cache preview with push notifications:

```sh
bun run build:ios-client --push-notifications --native-cache-preview
```

This writes `dist/ios/lumiverse-ios-arm64-native-cache-preview-push.ipa` and
includes the bundled frontend manifest in the build metadata. Install over the
existing bundle to retain server settings and WebKit storage. For an automated
test of the real wrapper, use a disposable `LumiverseClientSmoke` simulator:

```sh
bun run build:ios-client --simulator --debug --push-notifications --native-cache-preview
bun scripts/smoke-test-ios-native-cache.ts --simulator <UUID>
```

The test resets only that simulator's wrapper installation. It checks cached
login rendering, reload, a saved-server launch with a failing backend, online
fallback, re-enabling the cache, and native boot-health acknowledgement. It does
not log into a live account. Native diagnostics at
`Library/Application Support/NativeCache/status.json` contain bundle identity,
origin, and boot-health flags; they contain no account or session data.

## Native push notifications

The backend relays notifications directly to APNs over HTTP/2. The iOS app
registers its device token with the signed-in backend; it does not need a
background WebSocket or a separate relay service. Notification taps return to
the originating server's chat. Each destination records its signing environment
so development tokens use Apple's sandbox and production tokens use production.

Choose one provider credential method. Keep all private credentials on the
backend, outside the checkout and IPA, readable only by the backend account.
Restart the backend after changing credentials.

### Certificate authentication (`aps.cer`)

Apple's downloaded `.cer` contains the public certificate. It must be paired
with the private key generated when creating the certificate signing request.
Export that matching key from Keychain Access on the Mac where the request was
created, or use the original PEM key. An unrelated private key will not work.
If exported as `.p12`, convert the matching private key to PEM before configuring
Lumiverse. The backend accepts DER `.cer` and PEM certificates and supports
encrypted PEM private keys.

```dotenv
APNS_CERTIFICATE_PATH=/etc/lumiverse/apns/aps.cer
APNS_PRIVATE_KEY_PATH=/etc/lumiverse/apns/private-key.pem
APNS_PRIVATE_KEY_PASSPHRASE_FILE=/etc/lumiverse/apns/private-key-passphrase
APNS_BUNDLE_ID=chat.lumiverse.ios
```

Omit the passphrase setting for an unencrypted private key. Alternatively,
`APNS_PRIVATE_KEY_PASSPHRASE` can supply the passphrase through the service's
secret environment. Setting `APNS_CERTIFICATE_PATH` selects certificate
authentication; a Team ID or Key ID is not required in that mode. The backend
checks certificate dates, the bundle ID, and the matching private key.

A Sandbox & Production APNs certificate can authenticate to both environments.
Renew it before its expiration and restart the backend with the replacement
certificate and matching key. See Apple's
[certificate authentication documentation](https://developer.apple.com/documentation/usernotifications/establishing-a-certificate-based-connection-to-apns).

### Token authentication (`.p8`)

```dotenv
APNS_TEAM_ID=YOUR_TEAM_ID
APNS_KEY_ID=YOUR_KEY_ID
APNS_PRIVATE_KEY_PATH=/run/secrets/AuthKey_YOUR_KEY_ID.p8
APNS_BUNDLE_ID=chat.lumiverse.ios
```

Leave `APNS_CERTIFICATE_PATH` unset when using this method.

### Enroll and verify

Open the updated app, sign in to the configured server, and enable notifications
in Lumiverse's notification settings. Accept the iOS permission prompt, then use
the settings' test action. `/api/v1/push/ios/info` reports provider readiness to
authenticated callers without exposing certificates, keys, or device tokens.

Generation notifications respect the user's event preferences and presence
suppression. A successful APNs response means Apple accepted the alert; checking
its appearance and chat navigation on the iPhone completes delivery verification.
