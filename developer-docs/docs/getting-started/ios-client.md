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

Push-enabled builds also embed `LumiverseNotificationService`. Successful chat
generation alerts can show the character's avatar using Apple's communication
notification presentation. The signing profile must include both Push
Notifications and Communication Notifications for the app identifier, and the
extension needs its own bundle identifier (`chat.lumiverse.ios.NotificationService`)
and provisioning profile. The build helper embeds and signs the extension;
ordinary builds omit it and both capabilities. Rebuild the IPA and update the
backend to use this feature. Real-device APNs presentation still needs validation
with the provisioned app; compilation and backend tests do not establish it.

Live Activity avatars also require the `group.chat.lumiverse.ios.activities` App
Group on the host and `chat.lumiverse.ios.LiveActivity` extension. The build helper
adds matching entitlements. Register and enable that group for both App IDs in
Apple Developer provisioning when creating or refreshing their signing profiles.

Avatar access uses a short-lived signed URL for the destination owner's
character, without copying the app's login cookies into the extension. The
original alert remains available if downloading the avatar or donating the
communication intent fails. Failure alerts retain their diagnostic titles.

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

Successful completion alerts use the bundled `lumiverse-complete.wav` tone:
a 2.85-second mallet/glass melody over two layered synth chord voicings with
soft octave echoes and a filtered diffusion tail. The shorter preparing,
thinking, and responding cues share its D-major motif at lower levels.
Recreate all four original mono PCM16 / 44.1 kHz assets with
`bun run scripts/synthesize-notification-sound.ts`. The completion true peak
is −3 dBFS; stage peaks are −8 / −8 / −7 dBFS. There is no hard clipping.
The host and notification service extension both bundle the sound, so avatar
enrichment preserves it. Errors and generic test notifications use the system
sound. iOS notification sound settings and Silent mode still apply.

## Exports in Files

The native wrapper streams blob exports and authenticated download responses
through WebKit into its Documents directory. Finished exports appear under
**Files → Browse → On My iPhone / iPad → Lumiverse**. The folder becomes useful
after the first export. Duplicate names receive a numbered suffix; existing
files are preserved. Failed transfers stay out of Documents. Both
`UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` are enabled so
Files can access these documents. The server address, native cache, and WebKit
session data remain in their existing private storage locations.

This applies to the native iOS wrapper; browser and Home Screen PWA downloads
continue using their browser's destination.

## Live Activities

Push-enabled builds include a WidgetKit extension for generation status on the
Lock Screen and Dynamic Island (iOS 16.1+). Activities start while Lumiverse is
open and receive phase and terminal updates directly from the backend after the
app is backgrounded. Notification settings includes a device-local toggle;
ordinary push preferences remain independent. The widget shows character name
and phase, with no message or reasoning text. iOS 15 keeps its existing behavior.

Each scene activation refreshes APNs registration without prompting, reconciles
ActivityKit's current activities and tokens, and immediately retries pending
native token uploads. The frontend reconfigures enrollment on foreground and
network recovery, with bounded backoff after failures. It also checks UIKit's
current state every 15 seconds while JavaScript can run, repairing missed native
events without relying on WebKit's cached visibility. Suspended HTTP/native
requests are retired so they cannot block a new registration pass or start an
activity after account changes. A start interrupted by backgrounding remains
retryable; only activities actually created and then ended/dismissed suppress
another start for that generation. Deploy the updated frontend and install the
updated IPA together for this recovery behavior.

Once an activity has registered its ActivityKit token, it replaces the standard
generation push on that installation. The match includes account, generation,
device, bundle, APNs environment, and server origin. Other devices still receive
their ordinary notifications; an activity that never started, expired, or was
hidden/revoked doesn't suppress them. A just-ended activity remains covered
during its two-minute completion display to avoid racing the terminal update.
Successful background completion uses the same bundled tone in the ActivityKit
alerting **update**, followed by a silent **end** after ten seconds. Sound must
be attached to the update, not the end event. Background WebSocket reconciliation
leaves this activity alive so it cannot preempt the alerting push. The end
retains the ready card on the Lock Screen for two minutes. There is no second
standard push. These audible completion alerts respect
the notification enable/event preferences and foreground presence suppression.
The preparing / thinking / responding cues use the same alerting update path
and preferences. Each stage sounds at most once per activity as it advances;
the persisted stage high-water mark survives token rotation and server restarts.
Heartbeats, retries after successful delivery, and returns to earlier phases
stay silent. Stages skipped by the model are not backfilled with sounds.

On iOS 17+, the Lock Screen and expanded Island include **Stop response** and
**Hide activity** controls. Stop aborts the enrolled generation through its
scoped credential and preserves the normal partial-response saving behavior.
Hide dismisses the activity while generation continues. Both run in the app's
background process through `LiveActivityIntent`, with credentials remaining in
the app's Keychain. Completed activities offer **Read response**. Earlier iOS
versions retain tap-to-open behavior.

The status is the primary visual, with the character portrait, elapsed time,
and Prepare / Think / Write phase markers. These markers show the current
phase. A cached, saturated hue from the avatar colors the status, controls,
portrait rim, phase markers, and background wash, adjusted for readable contrast.
Missing or neutral avatars fall back to Lumiverse purple. Warning states keep
their amber semantics. Stage symbols use finite assembling, thinking, writing,
and completion effects on iOS 17+ (the writing wiggle requires iOS 18+), with
system transitions on older versions. ActivityKit caps animations at two
seconds per update; Reduce Motion and dimmed Always-On presentations stay still.
The markers do not estimate percentage complete or time remaining, and models
can skip thinking. Stale activities show **Waiting for update**. Ship the updated
server with the IPA: Stop requires
`POST /api/ios-activities/v1/registrations/:id/stop`. An unavailable server leaves
the activity running so the action can be retried.

Use the `.p8` setup above for Live Activities. If alerts already use a certificate,
keep those settings and add a separate provider key:

```dotenv
APNS_TEAM_ID=YOUR_TEAM_ID
APNS_KEY_ID=YOUR_KEY_ID
APNS_LIVE_ACTIVITY_PRIVATE_KEY_PATH=/run/secrets/AuthKey_YOUR_KEY_ID.p8
```

Build with `--push-notifications`. Provision the host app and both embedded
extension IDs, including `chat.lumiverse.ios.LiveActivity` (or the configured
bundle ID plus `.LiveActivity`). Enable `group.chat.lumiverse.ios.activities`
(or `group.{bundleId}.activities`) for both the host and Live Activity extension
to share prefetched avatars. `/api/v1/push/ios/activities/info` reports provider readiness without
exposing credentials. See the [Live Activities integration guide](ios-live-activities-plan.md)
for enrollment, lifecycle, APNs delivery, and the physical-device verification matrix.
