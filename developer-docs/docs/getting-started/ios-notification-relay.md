# iOS notification delivery

The official iOS app defaults to the Lumiverse relay at
`https://apn-relay.lumiverse.chat`. A self-built IPA can instead use its owner's
APNs credentials on the backend. Apple binds tokens to the signing app and
environment: credentials for a different Apple team cannot send to the official
Lumiverse app. A downloaded `.cer` needs its matching private key; it does not
replace an APNs `.p8` provider key.

## Delivery contract

`APNS_DELIVERY_MODE=auto` (the default) uses configured local credentials for their
bundle ID and otherwise uses the relay for `chat.lumiverse.ios`. `relay`, `direct`,
and `disabled` explicitly select one policy. A failed direct send never falls
back to the cloud. `GET /api/v1/push/ios/info?bundleId=…` reports the route for the
running IPA. Registrations store their route, encryption key, and scoped relay
credential privately; destination listings never expose these secrets.

The app asks for notification permission before enrollment. For relay delivery:

1. The native app saves a pending enrollment in its shared Keychain and calls
   `POST /v1/enrollments` with a random enrollment ID, APNs token, bundle ID,
   environment, and selected server origin.
2. The relay sends an APNs verification alert containing a random challenge.
   The native app or notification extension confirms only a locally requested,
   unexpired enrollment through `POST /v1/enrollments/{id}/confirm`.
3. The app polls `GET /v1/enrollments/{id}` with its enrollment polling secret.
   Successful verification returns separate management and delivery credentials.
   Only the delivery credential reaches the backend. It is bound to one token,
   topic, environment, and server origin. Delivery credentials cannot enroll
   other devices or activities.
4. `POST /v1/notifications` accepts that delivery credential and an encrypted
   alert envelope, or a restricted Live Activity status. It derives all APNs
   addressing and headers from the enrollment. It accepts no arbitrary URLs,
   headers, credentials, notification keys, or Apple topics.
5. The native app uses its management credential at `POST /v1/activities` to
   enroll an ActivityKit token. The resulting activity delivery credential is
   supplied to the backend's generation-scoped activity registration. Activity
   credentials expire with the activity and are revoked with their parent.

## Privacy

Updated apps create a distinct AES-256-GCM key for each selected server in the
shared iOS Keychain. Only the app and that backend receive the key. Alert title,
body, navigation, and avatar metadata are encrypted before leaving the backend;
the notification service extension decrypts using Apple's CryptoKit. The relay
and Apple see a generic alert, ciphertext, device token, server origin, timing,
and delivery metadata. If the extension cannot decrypt, iOS displays the generic
alert. Live Activity updates contain only an allowlisted phase and a fixed label;
ActivityKit consumes these directly, so they are not encrypted by this scheme.
HTTPS protects every network leg. This does not prevent the selected backend
from reading its own messages or keys.

Content keys and relay delivery credentials are encrypted at rest with the
backend's existing identity key. Deleting a destination stops backend sends and
requests relay revocation of that capability and its activities. If the relay is
offline, local removal still succeeds; the remote capability expires naturally.

The relay performs no callback, origin fetch, or avatar fetch. Private/LAN server
origins are metadata only; remote notifications still require the backend to have
outbound internet access. Alert delivery continues through APNs when iOS suspends
the app. Direct delivery also uses encrypted content when the installed app
supplies its encryption key; older direct-only IPAs retain ordinary alerts.

## Self-built IPA / direct delivery

Set `identifier` in `ios/tauri/src-tauri/tauri.conf.json` to your own app ID, then
build with `APPLE_DEVELOPMENT_TEAM=YOURTEAMID bun run build:ios-client --push-notifications`.
The build synchronizes the host, extension IDs, shared Keychain group and app
group to that identifier. Push requires a paid Apple Developer team. Set
`APNS_DELIVERY_MODE=direct` and `APNS_BUNDLE_ID` to that app's bundle ID, then use
either `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY_PATH` (`.p8`), or
`APNS_CERTIFICATE_PATH` (`.cer` DER/PEM) and `APNS_PRIVATE_KEY_PATH` (matching PEM
private key). Certificate alerts need a separate `.p8` for Live Activities.
Keep all Apple provider credentials on the server, outside the IPA and repository.

## Hosting the relay

The relay is a separate project, `Lumiverse-APNs-Relay`, with its own deployment
guide. It requires Lumiverse's APNs provider key, a persistent SQLite volume,
HTTPS at the configured hostname, bounded requests, and rate limits at the edge
as well as inside the service. Enrollment is automatic, but proof of an APNs
challenge is mandatory before a delivery credential is issued. Verification may
display a one-time connection alert. The app does not silently register arbitrary
notifications supplied by another caller.
