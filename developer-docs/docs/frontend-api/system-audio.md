# System audio

`ctx.systemAudio` gives a frontend extension a live **spectrum and loudness** of the sound the device is playing, so it can draw music visualisers or react to what the user is listening to. It is analysis only: an extension never receives samples, a `MediaStream`, or anything else that could be used to record or reconstruct what was played.

This is the user's desktop audio, not the microphone and not a tab they share. A web page cannot hear it: browsers expose only the microphone, or a tab or screen the user shares each time. The API therefore works only where the host has a native system-audio adapter, which today means no platform: the extension API, permission, consent and indicator described here ship first, and the desktop client's adapter ships separately (see [Native adapters](#native-adapters)). Until then `isAvailable()` reports `unsupported`, and extensions should treat that as a normal state.

## Availability and permission

Feature-detect `ctx.systemAudio` and `ctx.host.capabilities['system-audio-v1'] >= 1`. `lumiverse-spindle-types` 0.6.41 declares the optional API and exports its option, frame, session and availability types. It is optional for compatibility with older hosts and API mocks.

Declare `"system_audio"` in `spindle.json`. It is a privileged permission and is never auto-granted. `isAvailable()` is free; `start()` requires the permission.

```ts
const audio = ctx.systemAudio;
if (!audio || (ctx.host.capabilities['system-audio-v1'] ?? 0) < 1) return;

const { available, unavailableReason } = audio.isAvailable();
if (!available) {
  showHint(unavailableReason === 'disabled'
    ? 'Turn on system audio in the Lumiverse desktop client to use this.'
    : 'System audio needs the Lumiverse desktop client.');
  return;
}

let session: ReturnType<typeof audio.start> | undefined;
button.addEventListener('click', () => {
  try {
    session = audio.start({
      bands: 32,
      maxFps: 30,
      onFrame: ({ frequencies, amplitude, peak }) => drawBars(frequencies, amplitude, peak),
      onEnd: (reason) => showStopped(reason),
    });
    void session.ready.catch((error) => {
      if (error.name === 'NotAllowedError') showHint('No problem: nothing was started.');
      else if (error.name !== 'AbortError') showError(error);
    });
  } catch (error) { showError(error); }
});
stopButton.addEventListener('click', () => session?.stop());
```

Call `start()` directly from a user gesture such as a button handler.

## API

| Member | Behavior |
| --- | --- |
| `isAvailable()` | Returns `{ available: true }`, or `{ available: false, unavailableReason }` where the reason is `unsupported` (no adapter on this host or device) or `disabled` (an adapter exists, but the user has not enabled it). Free. Never prompts and never opens a device. |
| `start(options)` | Requires `system_audio`. Returns a session with `ready` and `stop()`. |

`start()` options:

| Option | Meaning |
| --- | --- |
| `onFrame(frame)` | Required. Receives `{ amplitude, peak, frequencies }`. |
| `bands` | Entries in `frequencies`: 8 to 64 (default 32). Out-of-range values are clamped. |
| `maxFps` | Most frames per second: 1 to 30 (default 30). The host drops frames above this rate. |
| `signal` | An `AbortSignal` that ends the session (and closes the prompt, if it is still open). |
| `onEnd(reason)` | Called once if the **host** ends a running session: `revoked` (permission withdrawn), `user-stopped` (the user pressed Stop on the host's indicator), `source-lost` (the device went away) or `host-disabled`. Not called after your own `stop()`. |

Every number in a frame is between 0 and 1. `frequencies` holds `bands` log-spaced magnitudes from roughly 40 Hz to 14 kHz, lowest first. `amplitude` is the overall level and `peak` the loudest recent level.

`session.ready` resolves when the user has approved and analysis has begun. It rejects with a `NotAllowedError` `DOMException` if the user declines, `NotSupportedError` if nothing can provide audio, and `AbortError` if the session was stopped or aborted first.

## What the user sees

- **A prompt on every start.** `start()` shows the host's own confirmation, titled with your extension's name. Its wording comes from the host, not from you, and there is no remembered approval: every `start()` asks again. A declined prompt starts nothing.
- **An indicator for as long as it runs.** The host draws a persistent "*name* is analysing system audio" pill with a **Stop** button outside any extension's DOM, so an extension can neither hide nor restyle it. Pressing Stop ends the session immediately (`onEnd('user-stopped')`).
- **Nothing is recorded or sent.** The host passes you the analysis above, rebinned and rate-limited. Nothing is stored.

## Limits and cleanup

- One session per extension at a time; a second `start()` throws `SYSTEM_AUDIO_BUSY` until the first ends.
- `stop()` is idempotent and releases the device at once, including while the device is still starting.
- Revoking `system_audio`, unloading or reloading the extension, aborting the `signal`, the indicator's Stop button and the source going away all end the session. After revocation `start()` throws `PERMISSION_DENIED:system_audio` while `isAvailable()` keeps working. Retained references from an unloaded extension reject with `SPINDLE_FRONTEND_INACTIVE`.
- A frame that arrives after the permission was withdrawn is dropped and ends the session rather than being delivered.
- A throwing `onFrame` is logged and does not stop the session.

This API is frontend-only. Backend workers can receive what you derive from it through the existing frontend messaging API.

## Native adapters

The frontend reaches the device through a small host-internal contract in `frontend/src/lib/spindle/system-audio-source.ts`. A native adapter registers a `SystemAudioSource` with `registerSystemAudioSource()`; extensions cannot reach this registry. A source reports `availability()` cheaply and with no side effects, and `start(handlers)` begins capture and delivers **analysis frames** (`amplitude`, `peak`, any number of log-spaced bands) to `handlers.onFrame`, calling `handlers.onEnd` if it stops on its own.

The contract carries analysis only, so audio samples never enter the JavaScript realm the extension shares. An adapter is responsible for:

- applying the platform's own consent (and a clear off switch in the client), in addition to the host's prompt, and reporting `disabled` until the user has turned it on;
- doing the analysis natively (for example WASAPI loopback on Windows) and never exposing samples, file paths or device identifiers across IPC;
- stopping on session lock, sleep, sign-out or device loss;
- being tested on a real device: CI cannot validate loopback devices, drivers, or lock behaviour.

No adapter is included yet, so on every current host `isAvailable()` returns `{ available: false, unavailableReason: 'unsupported' }`.
