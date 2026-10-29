# Desktop capture from a Spindle worker

The first integration exposes `spindle.desktop.capture` in backend extension workers. It does not expose a frontend capture API, native IPC commands, filesystem paths, browser media streams, or raw capture bytes to extensions.

The desktop client includes an opt-in native transport and macOS/Windows adapters. On macOS 14+ or Windows 10 1903+/Windows 11, use **Set Up Screen Capture** in the extension's permissions area, or the top-level **Let Extensions Capture the Screen** toggle beside system audio in the desktop tray. Setup opens trusted desktop controls and connects the selected local or remote instance through native OAuth. Capture is disabled by default. The toggle stays enabled until the user turns it off. After explicit setup, the transport reconnects for that same selected instance using existing native credentials, including after restart or transport failure. Interrupted captures are canceled and never replayed. Until connected, `listDevices()` returns an empty list. The host capability `desktop-capture-worker-v1` describes protocol availability, not OS capture support or permission.

Linux still advertises no capture capability: its portal/GPU encoder integration is not implemented. There is no browser, X11, or FFmpeg capture fallback. Replay buffers are not implemented or advertised on any platform yet.

## Native macOS adapter

- There is no Capture & Send window, local review panel, or second Send step. Missing screen-recording permission is requested directly through macOS; existing app-wide permission is reused. System-audio-only permission does not authorize screen capture.
- First use opens a native menu of displays and other apps' windows. Selecting a source starts capture and remembers the approval immediately, independently of whether that capture succeeds or is canceled. Later matching requests capture that same source without another picker. Display identity is stored using its native UUID. Window identity is limited to the current desktop process and owning application lifetime; it is never restored by matching a title. Missing sources ask for a new choice without selecting a replacement automatically.
- Remembered approval is native and scoped to the instance, OAuth account, installation, capture kind, current permission-grant fingerprint, connection revision and destination. Image approval does not authorize video. Revoking and regranting capture or generation permission changes the fingerprint even if the desktop was offline. Older commands without these fingerprints remain one-shot and cannot create remembered approval.
- Screenshots use `SCScreenshotManager` and stay in native memory. Video uses `SCStream` with hardware-required VideoToolbox/AVAssetWriter H.264 encoding, at most 1920×1080/30fps and 1–30 seconds. Audio and microphone capture remain disabled. A private temporary MP4 is removed after completion/cancellation; abandoned directories are cleaned on startup. File deletion and best-effort buffer clearing do not guarantee secure erasure from SSDs, swap or framework copies.
- A native menu-bar indicator shows the extension, destination and recording countdown. **Cancel This Capture** discards only the current request and preserves saved permissions. Only explicitly turning off **Let Extensions Capture the Screen** in the desktop tray disables requests and forgets saved approvals. This disabled state survives restart. Turning the toggle on again enables requests without starting a capture; the next request requires source selection.
- Expiry, screen lock/session inactivity, source loss, permission revocation, instance/account changes and transport loss cancel pending work. Screen permission is checked before capture, during permissioned capture and before release. Source identities and media stay native. There is no always-on buffer.

`listDevices()` lists connected desktop clients, not their windows, applications or monitors. Do not redirect a saved target to another device. Updated clients retain their device identity across reconnects; older clients receive a new registration. Refresh discovery when the saved device becomes unavailable.

### Persistent source approval

Source selection authorizes this image or bounded clip and release to the displayed instance/model, plus future matching requests using that same source while the tray toggle remains enabled. Turning capture off removes saved approvals. There is no capture window, local review step, or second Send click. Canceling a request preserves its saved source approval. An extension cannot select a native source, write approval records, or enable capture through a request flag.

The flow is extension **Share** → native source selection on first use → capture and validation → opaque asset return → generation/optional TTS. With a matching remembered approval, later requests go directly to capture with native activity/cancellation controls. The broker still checks permissions, worker/account ownership and the exact connection revision before delivering or consuming an asset. Discard before release uploads nothing; a released upload cannot be recalled.

The public worker request shape is unchanged. Native commands now include an opaque destination revision and permission-grant fingerprint; no connection secrets are exposed. Older desktop clients ignore these fields and retain their one-shot behavior. New desktop clients accept older command envelopes without remembering them.

## Native Windows adapter

- A dedicated STA thread opens `GraphicsCapturePicker` directly when a new source is needed. An invisible native owner window supplies the picker handle and receives session notifications; it has no capture controls or visible HUD. Selecting a source authorizes capture and send and remembers the exact OS-selected item immediately. Subsequent matching requests reuse that item while the desktop process and source remain alive. After restart or source closure, the system picker is required again; window titles are never used to find a replacement. The picker selects one window or display; the OS capture border is not suppressed.
- Availability requires UniversalApiContract v8 (Windows 10 1903+) and `GraphicsCaptureSession.IsSupported()`, plus a hardware D3D11 device. A free-threaded two-frame capture pool supplies GPU surfaces. Source size is validated before starting; source resize/closure cancels rather than capturing stale/padded pixels.
- Screenshots use a bounded native-memory PNG encoder. Video uses GPU-backed `MediaStreamSource` samples and `MediaTranscoder`, with `HardwareAccelerationEnabled = true`. This is **hardware-preferred, not hardware-guaranteed**: Windows may select software H.264. Capability probing does not prove encoder selection or codec availability; actual preparation can still reject recording. macOS's hardware-required policy is unchanged.
- Recordings omit audio and use at most 1920×1080/30fps, 4 Mbps, and the requested 1–30 seconds. The MP4 stays in `InMemoryRandomAccessStream`; its size is monitored and oversized output is discarded. The 32 MiB release limit is not a hard allocator limit on transient framework buffers. Native MediaPlayer playback checks the actual duration, dimensions, and absence of audio, and must produce a decoded frame before automatic release. This validation does not open a preview window.
- Cancellation, command expiry, source closure/resize, Windows session lock/logoff/disconnect, suspend, permission/worker cancellation, and transport shutdown discard native state. Session notification registration must succeed. Sample deferrals are completed even on cancellation, queue overflow, or native errors; callbacks/preview slots are bounded. Source selection or a matching remembered native approval authorizes release; media validation still runs before delivery. Canceling a request preserves saved approval. Explicitly turning the tray toggle off stops pending capture, disables requests and forgets approvals; automatic reconnect cannot re-enable it.
- No Windows recording file is created, but OS swap and framework copies are outside the buffer-clearing guarantee. Windows N systems may need the Media Feature Pack for H.264 recording/playback. Test on a physical Windows session; CI/cross-compilation cannot validate picker consent, drivers, encoder choice, or screen-lock behavior.

Native credentials, device leases, frames, file paths, and previews do not cross Tauri IPC. Enable/disable/status and approval-reset commands are scoped to the bundled `main` tray window, checked again against its label and URL in Rust, and explicitly declared in the application ACL. The primary frontend has only a setup-request command, which opens trusted desktop setup; it cannot enable capture or grant approval. The native transport verifies the OAuth account before registration and after token changes; a different account cannot inherit the active device lease or consent context. Local instance capture may require a separate desktop OAuth sign-in; the integrated browser's cookie is not reused.

Hardware capture, actual picker behavior, screen-lock cancellation, video playback, and byte/duration bounds require an on-device acceptance test before release. Compiling or running protocol tests does not validate those OS interactions.

### On-device acceptance

1. Use the extension permissions area's setup button for local and remote instances. Confirm native OAuth account/instance identity, then restart and interrupt/recover transport. Availability should reconnect only for the saved selected instance; interrupted requests must fail without being replayed.
2. On macOS, test with screen permission denied, granted and already granted. Confirm only the macOS permission prompt and native source menu appear, with no Capture & Send window. Selecting a source must start capture immediately. Repeat the request without another picker, then request video and require separate source approval. Revoke screen permission during recording and confirm discard.
3. Remember a display and restart the app; only that same display UUID may restore. Remove that display and confirm source selection without capturing another display. For windows, close/reopen the application or restart Desktop and confirm fresh selection. On Windows, repeat requests in one desktop process without another picker, then close the source/restart and require the system picker again.
4. Cancel a capture from the native indicator, dismiss source selection, and interrupt a recording. Confirm saved approvals and the tray toggle remain enabled, and another matching request needs no new permission. Then uncheck **Let Extensions Capture the Screen** and confirm the tray toggle is off and approvals are forgotten. Reload the extension and restart Desktop: capture must remain off without automatic reconnect. Enable the toggle again; it must not capture by itself, and the next request requires fresh source selection. Switch accounts/instances, reinstall the extension, or revoke/regrant capture or generation permission while Desktop is offline; no old approval may be reused.
5. Verify 1-second and 30-second clips, dimensions, no audio, playback, byte limits, encoder requirements, screen-lock/sleep cancellation, worker unload and network loss. Verify both first-use and remembered requests complete without a capture or preview window. Confirm canceled work never reaches generation and native indicators disappear after completion.
6. Send forged setup/control calls from remote content and floating widgets. Only the primary frontend may request setup; native enable/reset commands and media/source identities must stay inaccessible. Test old command envelopes and old desktop builds. Existing native prompt limits apply to requests needing setup; remembered requests still obey broker capture cooldowns and resource limits.
7. Confirm the same device ID after reconnect, app restart and backend restart, with fresh private leases and canceled old work. Approval discovery must not prompt, record, choose a source or change an approval. Verify remembered, required, paused, missing-source and permission-required states, including revoke/regrant while a query is pending. Older clients must report unknown without receiving an unsupported query.

## Extension permissions

Declare `screen_capture` for images, `screen_recording` for video, and `generation` to send approved captures to a model. Both capture permissions are privileged and never auto-granted. A grant is only permission to request capture; native device-owner approval is also required, either for this request or through an explicit matching remembered approval.

An extension must select an explicit desktop device and an owned connection profile. Captures are bound to the worker runtime, extension installation, user, and connection revision. Changing the provider, model, endpoint, or connection configuration invalidates a handle. Handles expire after two minutes and are consumed once. Unload, capture/generation permission revocation, or native device disconnect cancels pending requests and removes retained captures.

```ts
const devices = await spindle.desktop.capture.listDevices()
if (!devices.length) return

const capture = await spindle.desktop.capture.request({
  deviceId: devices[0].id,
  connectionId,
  purpose: 'Describe the selected application window',
  kind: 'image',
})

await spindle.generate.raw({
  connection_id: connectionId,
  provider,
  model,
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'Describe this screenshot.' },
      { type: 'desktop_capture', asset_id: capture.assetId },
    ],
  }],
})
```

Operator-scoped extensions must supply `userId`; user-scoped extensions cannot switch ownership by supplying a different user. Use `capture.release(assetId)` to discard an unused capture. References are supported only in raw generation and raw streaming, not batch/quiet generation or normal chat persistence.

For video, use `kind: 'video'`, `mode: 'record' | 'replay'`, and `durationSeconds` (1–30). A replay request is not an instruction to arm recording: it may export only from a buffer already explicitly armed in trusted native UI. The initial provider allowlist accepts images for Google, Google Vertex, OpenAI, Anthropic, and OpenRouter adapters; video is limited to Google and Gemini-protocol Google Vertex models (`google_vertex`). The chosen model must also support the supplied media. Unsupported providers are rejected rather than silently dropping media. Capture-backed generation rejects caller parameters that override models, routing, destinations, or message bodies.

## Native-client protocol

### Stable devices and approval discovery

New desktop clients keep the same `device.id` across reconnects and restarts for
the same desktop installation, instance and OAuth account. `stableIdentity: true`
identifies this support. Extensions can remember that ID as the user's device
choice rather than asking for a new registration on every reconnect. A device
still disappears from `listDevices()` while offline. Its private transport lease
rotates on reconnect, and interrupted captures/assets are canceled.

Use `spindle.desktop.capture.getApprovalStatus({ deviceId, connectionId, kind, userId? })`
to query approval for this extension installation, capture kind, permission-grant
revision and exact model destination. It requires the same capture and generation
permissions and connection ownership as a capture request. The backend advertises
`desktop-capture-approval-status-v1` for method discovery.

```ts
const status = await spindle.desktop.capture.getApprovalStatus({
  deviceId: savedDeviceId, connectionId, kind: 'image',
})
// status.approval: 'required' | 'remembered' | 'paused' | 'unavailable' | 'unknown'
// status.source: 'ready' | 'missing' | 'permission_required' | 'unknown'
// status.checkedAt: backend timestamp in milliseconds
```

Discovery never opens a picker, requests OS permission, starts capture or creates
an approval. It returns no source identifiers, titles, media, or credentials.
`remembered` reports a saved approval; `source` separately describes whether its
source can currently be reused. `paused` requires the owner to re-enable capture from the tray. Updated clients disconnect when capture is turned off, so device discovery may instead report the device unavailable.
Older desktops without `approvalStatusSupported` return `unknown` without receiving
an unsupported native command. Older desktops also keep session-only device IDs.

Status is advisory and can change immediately; it is not an authorization token.
A later capture always rechecks permissions and native consent/source availability.

### Transport

All routes are under `/api/desktop/v1/capture` and require the existing desktop OAuth access token, verified audience/issuer, and the `lumiverse-desktop` authorized client. Do not call them from extension/frontend JavaScript or expose the access token or lease token to a WebView.

- `POST /devices`: register `{ name, platform, capabilities: { image, video, replay }, deviceKey?, approvalStatus? }`; returns a device descriptor and a private `transportToken`. New native clients send a persistent opaque 64-character device key scoped to instance/account and `approvalStatus: true`; the key is never exposed to extensions.
- `GET /devices/:deviceId/commands`: poll using `X-Lumiverse-Capture-Lease: <transportToken>`. Poll well within the 45-second device lease. Commands are delivered once; a transport failure must not silently repeat a consent prompt.
- `POST /devices/:deviceId/responses`: submit an approved media response or a denial/cancellation/unsupported/failure outcome, using the same lease header.
- `DELETE /devices/:deviceId`: disconnect, cancel requests, and discard retained media.
- `POST /devices/:deviceId/approval-status`: reply to a read-only `approval_status` command with `{ requestId, approval, source }` using the same private lease. Commands contain the extension/grant fingerprint, kind and destination, never a request to capture. Queries expire after ten seconds and recheck backend authorization before returning status.

An approved response has `{ requestId, outcome: 'approved', media: { mimeType, data, width, height, durationSeconds? } }`; `data` is standard padded base64. A non-approved response has `{ requestId, outcome }`. Error text from the native client is deliberately not relayed to extensions. Allowed MIME types are PNG/JPEG/WebP images and MP4/WebM video. Images are inspected with pixel limits; video currently receives container-signature and metadata checks, not complete codec/duration inspection. The native encoder must enforce the real clip duration and omit audio.

The broker retains assets only in bounded backend memory: 8 MiB/image, 32 MiB/video, 64 MiB globally. Because release uploads to the connected instance, local approval must explicitly name both that instance and the model destination. Transport to a remote instance must use HTTPS. Request and response bodies for capture-backed model calls are excluded from request history. Model output itself still reaches the requesting extension and may disclose screen contents.

## Required native security boundary

Before advertising any capability, the native adapter must:

- Use the platform's consent-preserving picker/portal and trusted bundled UI, not extension-controlled UI.
- Show the requesting extension, selected source, purpose, connected instance, exact model destination, and retention limits. Treat server-provided labels as untrusted text.
- Require explicit local approval before capture and release, either for this request or as a matching remembered native grant. An OS-wide permission grant alone does not authorize individual extensions.
- Keep raw frames, encoder state, and replay storage native. Never send them through the shared frontend JavaScript realm.
- Keep indicators and a trusted stop control visible; stop on cancellation, expiry, screen lock, logout, instance changes, source closure, or transport loss. Expired commands cannot authorize new capture.
- Enforce the command's byte/pixel/duration limits, no audio, and a bounded private recording buffer. Never start/rearm a replay buffer from a worker request.
- Connect through a native-only authenticated transport. Do not add privileged capture commands to existing wildcard-origin Tauri capabilities.

The server protocol cannot prove that a native producer actually showed a picker or approval UI; those safeguards must be implemented and tested in the desktop adapter before capture capabilities are enabled. It does not defend against native malware, a compromised OS, or an upstream model retaining already-approved uploads.
