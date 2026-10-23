# Native Android notifications

The Android client uses one native renderer for completion and error alerts.
Local hosting receives notification-only WebSocket frames while the embedded
backend is running. Remote hosting uses FCM data messages, so receipt does not
depend on a running WebView. Force-stopping the app prevents receipt until it is
opened again. Neither transport keeps an embedded generation alive after Android
terminates the backend.

## Configuration

Build the APK with `LUMIVERSE_ANDROID_FIREBASE_CONFIG` pointing to the Firebase
Android application's `google-services.json`. Its package must match
`chat.lumiverse.prototype`. This file contains client configuration, not a provider
private key. Without it, local notifications still work.

On the remote backend, set `FCM_SERVICE_ACCOUNT_PATH` to a Firebase service-account
JSON file and `FCM_PROJECT_ID` to the APK's Firebase project ID. The account must
have permission to send messages for that project. Never package provider keys in
the APK. This implements direct operator-managed FCM; it does not provide a
hosted relay for unrelated self-hosted servers.

## Enrollment contract

The existing browser-session authenticated `/api/v1/push` API gains:

- `GET /android/info`: `{ configured, projectId, serverInstanceId, reason }`.
- `POST /android`: `{ deviceId, transport: "local" | "fcm", serverOrigin,
  accountId?, deviceToken?, projectId?, label?, userAgent? }`. Returns HTTP 201 with
  `{ destination, credential, serverInstanceId }`. The public destination type is
  `android_native`; registration tokens and hashed credentials are not listed.
  Invalid inputs return 400, unavailable FCM configuration returns 503. Local
  enrollment accepts only loopback origins on an embedded Android backend.
  The native registration supplies `accountId`; a mismatch with the authenticated
  session rejects an enrollment that raced an account switch.

Existing list, delete and per-destination test operations include Android.
Enrolling again rotates the notification-only credential and closes old sockets.
Account changes transfer a device's enrollment on that server. Deletion revokes
its socket and outstanding tickets. Native enrollment is scoped to the selected
server, account, destination, and server instance.
Startup, native resume, and token-change events reconcile existing opt-in without
prompting or automatically enrolling a device that has no server destination.

Outside browser-session authentication, the narrowly scoped native transport has:

- `POST /api/android-notifications/v1/ticket`, with `Authorization: Bearer
  {credential}`: returns a single-use, 30-second notification-only ticket for a
  local destination, plus `serverInstanceId` for identity verification. Exchange
  it at `/api/ws?notificationTicket={ticket}`.
- `GET /api/android-notifications/v1/avatar/{destinationId}/{characterId}` with
  `expires` and `signature` query parameters: a short-lived capability for the
  destination owner's bounded JPEG thumbnail. Invalid proofs return 401;
  revoked destinations or unavailable owned avatars return 404. No cookies or
  general media credentials are sent by the renderer.

FCM delivery uses a bounded JSON `payload` data field plus `destinationId`,
`serverOrigin`, and `serverInstanceId`; tokens are never exposed to extensions.
User-visible messages use high priority and a one-hour TTL. The backend removes
only the exact token registration that FCM reports as `UNREGISTERED`. Transient
failures leave enrollment intact. `sent` counts transport acceptance, not proof
that the OS displayed an alert.

Completion alerts can show a character avatar. Errors retain their failure title
and plain text. Media failures fall back to text. Notification taps accept only
the enrolled server's validated chat path (or `/`), including cold starts. The
embedded runtime can retain a pending tap across a loopback port change; its
obsolete local enrollment is then refreshed by the authenticated page. Server
and account switches clear native state and already displayed notifications.
Android 13+ permission and notification channel settings remain user-controlled.

## Verification

Run the backend tests with `bun test --isolate src/routes/android-notifications.routes.test.ts
src/services/fcm.service.test.ts android/notification-policy.test.ts`. Frontend
enrollment tests live in `frontend/src/hooks/usePushSubscription.android.test.tsx`.

For real HTTP client verification against local contract fixtures:

```sh
postman simulation run postman/simulations/android-notifications.sim.yaml --port 4917 --output ndjson
# In another terminal:
LUMIVERSE_FCM_SIM_URL=http://127.0.0.1:4917/firebase bun test --isolate src/services/fcm.service.test.ts
```

The local fixtures model Google's OAuth token response and FCM acceptance,
`UNREGISTERED`, project-not-found and transient-unavailable responses. This does
not verify Google credentials or delivery on a device. No owning provider mock
was available in this repository; fixtures follow the public provider contract.
