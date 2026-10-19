# Lumiverse Android app

The ARM64 APK includes the Tauri client, Bun backend, and native libraries. On
first launch, choose **Use this device** to host locally or enter an existing
Lumiverse server's HTTP or HTTPS address and choose **Connect**. Enter the server
origin, such as `https://chat.example.com` or `http://192.168.1.10:7860`, without a
path or login credentials. Sign in through the server's normal login page.

The selected connection is saved for the next launch. Remote mode does not start
the embedded backend. Switching modes preserves the on-device database; remote
data remains on the selected server. HTTP connections are unencrypted.

Remote mode uses the hosted server's frontend. Deploy the updated frontend on
that server to receive the scrolling and import-refresh fixes there too.

Native clients skip the browser's silent audio unlock workaround. Notification
sounds and enabled TTS playback initialize audio only when a sound is requested;
touching the app or sending a text message does not play a silent file or buffer.

To switch servers or return to local hosting, press Android Back at the first
page, or press and hold with two fingers to open the native app controls. The
controls also work when a server cannot load. Reload and Close app are available
there as well.

Data Portability imports automatically reload the frontend after completion so
database-backed views and extensions start from fresh data. The native app and
backend remain running. Imports are tracked outside the settings panel and
recover through polling after a dropped WebSocket, backgrounding, or a page
restart. The import result is shown again after reloading.

## Build and verify

Build with `bun run build:android-tauri`. The debug-signed APK is written to
`dist/android/lumiverse-tauri-arm64.apk`. Install it over an existing build signed
with the same development key to preserve local data.

On an explicitly selected test emulator with the APK installed:

```sh
bun run scripts/smoke-test-android-connection.ts --serial emulator-5554
bun run scripts/smoke-test-android-prototype.ts --serial emulator-5554 --require-tauri --require-native --attempt-backend
```

The connection smoke test checks HTTP/HTTPS navigation, cookies, saved selection,
native recovery, IPC isolation, and both connection modes. It finishes in local
mode. The backend smoke test checks native libraries, storage persistence, and
frontend startup. Add `--restore-backup` on a fresh disposable install, or supply
`LUMIVERSE_ANDROID_TEST_PASSWORD` for its existing `prototypecheck` test account,
to verify real backup restoration and the frontend reload.
