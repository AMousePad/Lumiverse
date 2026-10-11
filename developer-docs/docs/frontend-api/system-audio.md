# System audio

`ctx.systemAudio` gives a frontend extension a live **spectrum and loudness** of the sound the device is playing, so it can draw music visualisers or react to what the user is listening to. It is analysis only: an extension never receives samples, a `MediaStream`, or anything else that could be used to record or reconstruct what was played.

This is the user's desktop audio, not the microphone and not a tab they share. A web page cannot hear it: browsers expose only the microphone, or a tab or screen the user shares each time. The API therefore works only where the host has a native system-audio adapter: today that is the Lumiverse desktop client on Windows, macOS 14.2+ and Linux with PulseAudio or PipeWire, once the owner has switched it on in the tray (see [Native adapters](#native-adapters)). Everywhere else `isAvailable()` reports `unsupported`, and extensions should treat that as a normal state.

## Availability and permission

Feature-detect `ctx.systemAudio` and `ctx.host.capabilities['system-audio-v1'] >= 1`. `lumiverse-spindle-types` 0.6.43 declares the optional API and exports its option, frame, session and availability types. It is optional for compatibility with older hosts and API mocks.

Declare `"system_audio"` in `spindle.json`. It is a privileged permission and is never auto-granted. `isAvailable()` is free; `start()` requires the permission.

```ts
const audio = ctx.systemAudio;
if (!audio || (ctx.host.capabilities['system-audio-v1'] ?? 0) < 1) return;

const { available, unavailableReason } = audio.isAvailable();
if (!available) {
  showHint(unavailableReason === 'disabled'
    ? 'Tick "Let Extensions Analyse System Audio" in the Lumiverse tray menu to use this.'
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
| `isAvailable()` | Returns `{ available: true }`, or `{ available: false, unavailableReason }` where the reason is `unsupported` (no adapter on this host or device) or `disabled` (an adapter exists, but the user has not switched it on in the desktop client's tray menu). Free. Never prompts and never opens a device. |
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
- **An indicator for as long as it runs.** The host draws a persistent "*name* is analysing system audio" pill with a **Stop** button outside any extension's DOM, so an extension can neither hide nor restyle it. Pressing Stop ends the session immediately (`onEnd('user-stopped')`). The user can minimise the pill to a small ♪ chip when it is in the way; the chip is never removed while a session runs, Stop is one click from it, and each new session starts expanded. Only the user's own click on the host's component can do this, never an extension.
- **Nothing is recorded or sent.** The host passes you the analysis above, rebinned and rate-limited. Nothing is stored.

## Limits and cleanup

- One session per extension at a time; a second `start()` throws `SYSTEM_AUDIO_BUSY` until the first ends.
- `stop()` is idempotent and releases the device at once, including while the device is still starting.
- Revoking `system_audio`, unloading or reloading the extension, aborting the `signal`, the indicator's Stop button and the source going away all end the session. After revocation `start()` throws `PERMISSION_DENIED:system_audio` while `isAvailable()` keeps working. Retained references from an unloaded extension reject with `SPINDLE_FRONTEND_INACTIVE`.
- A frame that arrives after the permission was withdrawn is dropped and ends the session rather than being delivered.
- A throwing `onFrame` is logged and does not stop the session.

This API is frontend-only. Backend workers can receive what you derive from it through the existing frontend messaging API.

## Native adapters

The frontend reaches the device through a small host-internal contract in `frontend/src/lib/spindle/system-audio-source.ts`. A native adapter registers a `SystemAudioSource` with `registerSystemAudioSource()`; extensions cannot reach this registry. A source reports `availability()` cheaply and with no side effects, and `start(handlers, { maxFps })` begins capture and delivers **analysis frames** (`amplitude`, `peak`, any number of log-spaced bands) to `handlers.onFrame`, calling `handlers.onEnd` if it stops on its own. `maxFps` is a hint so a source never does more work than the extension will use.

The contract carries analysis only, so audio samples never enter the JavaScript realm the extension shares. An adapter is responsible for:

- applying the platform's own consent (and a clear off switch in the client), in addition to the host's prompt, and reporting `disabled` until the user has turned it on;
- doing the analysis natively and never exposing samples, file paths or device identifiers across IPC;
- stopping on session lock, sleep, sign-out or device loss;
- doing no work while nothing is audible or nobody is looking;
- being tested on a real device: CI cannot validate loopback devices, drivers, or lock behaviour.

### The desktop client's adapter

The Lumiverse desktop client (Tauri) includes an adapter for Windows, macOS and Linux. A browser never registers one.

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Source | WASAPI shared-mode loopback on the default output | Core Audio process tap on everything the device plays | The monitor of the default output, read through `parec` |
| Needs | Windows 10 or later | macOS 14.2 or later | `parec` in `/usr/bin`, `/bin`, `/usr/local/bin` or `/run/current-system/sw/bin` (`pulseaudio-utils`, or `pipewire-pulse` on PipeWire) |
| OS permission | None | **System Audio Recording** (not Screen Recording), asked by macOS on first use | None |
| Reports `unsupported` when | Never | Older than 14.2 | `parec` is not installed (for example inside a Flatpak or Snap) |
| Lock | Read from the session's state | Notification | Best effort: asks logind (`LockedHint`) every few seconds |
| Sleep | Power notification | Notification | Exact: uptime runs ahead of the monotonic clock |
| Default output changes | Followed | Followed | Looked up again after ten seconds of quiet |
| Hidden window | Packets drained and discarded | The tap's IO is stopped | The `parec` process is killed and restarted when the window returns |
| Verified on hardware | Yes | **Not yet** | **Not yet** |

**Turning it on.** The feature is off until the owner switches it on in the tray menu with **Let Extensions Analyse System Audio**, which explains what it does and asks first. The choice is remembered. Until then `isAvailable()` reports `disabled`. While an extension is analysing, the tray item reads **Extension Is Analysing System Audio** and the tray icon's tooltip says so; unchecking the item ends every session at once (`onEnd('host-disabled')`). This native switch is the guarantee that listening is never silent: extension code shares the frontend's JavaScript realm, so the web layer's per-start prompt cannot by itself stop a forged call to the native command.

**What crosses IPC.** Native code accepts "start at *n* fps" and "stop", with an opaque key identifying the adapter installation so late cleanup cannot stop a newer session. Nothing the page sends can pick a device or a format. What comes back is one small message per frame, a fixed-size block of little-endian `f32`s (`[kind, amplitude, peak, 64 bands]`, 268 bytes), over a Tauri channel. Samples, device names and paths never leave the capture thread, and on every platform the analysis is the same code (`analyzer.rs`), so a visualiser looks the same everywhere.

**Who may call it.** Only the primary `frontend` window can start or stop a session (`desktop-system-audio-session`). Only the bundled tray host can flip the switch (`desktop-system-audio-controls`, checked again in Rust against the window label and URL). Floating-widget windows, which host extension pages, receive no grant. A session also ends when the page reloads or the window is destroyed, since nothing is left to receive frames.

Device opening is part of the native session: stop, reload and disable also cancel an opening device, and a late handle is released. Removing the frontend adapter ends its subscribers and stops its own native session. Shared analysis follows the fastest remaining subscriber's frame rate in both directions. On Windows, the default endpoint identity is checked every half second even when the old endpoint is still connected. On macOS, the aggregate includes only the process tap; physical microphone inputs are excluded, and callback buffers are validated before downmixing.

**What ends a session.** The owner unchecking the tray item (`host-disabled`); the session locking, the machine going to sleep, or the output device going away and not coming back within about three seconds (`source-lost`).

**Cost.** Hardware use is the design constraint, not an afterthought, and the pacing is one shared engine (`engine.rs`) rather than per-platform code:

- Silence costs almost nothing. After half a second without sound the adapter sends one zero frame, drops its analysis, and wakes ten times a second just to look for new audio. (On Windows a loopback stream delivers no packets at all while nothing plays. macOS keeps delivering short callbacks of zeros, and a Linux monitor stream may keep delivering silence; both are discarded without analysis.)
- Active cost is one FFT per emitted frame (a 2048-point transform at 44.1/48 kHz, larger at higher sample rates so low bands stay resolved) at the frame rate the extension asked for, with every buffer allocated once and no per-packet work beyond a mono downmix. Several extensions share one native session, run at the fastest rate any of them requested, and the session ends when the last one leaves.
- A hidden or minimised frontend window pauses analysis, as the table shows.
- No adapter uses event handles, MMCSS or a raised system timer resolution, which would cost every process on the machine power.
- Measured on Windows 11 with a release build at 30 fps with audio playing: about 0.1 % of one core.

**Limits.** One native capture at a time (extensions share it). Windows does not read packed 24-bit mix formats; the shared-mode mix format is almost always 32-bit float. Starting needs an output device; without one `start()` rejects. On macOS a refused permission makes `start()` reject with instructions; a revoked one later can show as silence.

### On-device acceptance

CI can compile every platform and run the engine, analyser and pipe logic, but it cannot exercise a device, a lock screen or the tray. Windows has been run against real hardware; macOS and Linux have **not**, so they need the full list before release. On a physical session of each OS:

1. With the tray item off, `isAvailable()` is `disabled` and `start()` is refused. Turn it on, start a session, then turn it off while the session runs: the extension gets `host-disabled`.
2. Start from an extension and confirm the host prompt, the in-app indicator, the tray text and the tooltip. Play music: bars follow it. Pause it: frames stop within about a second after one zero frame. Activity Monitor, Task Manager or `top` shows no measurable CPU at idle.
3. Minimise or hide the window: CPU drops to idle (on Linux, `pgrep parec` finds nothing). Restore it: frames resume.
4. Lock the session, sleep and resume, switch the default output device, and reload the frontend: the session ends (or, for a device change, follows the new device) and no tray "in use" text is left behind.
5. Two extensions listening at once share one session; stopping one leaves the other running; stopping both returns the tray to idle.
6. From a floating widget window, attempt `window.__TAURI_INTERNALS__.invoke('desktop_system_audio_start', …)`: it is denied. Attempt it from the main frontend with the tray item off: it is refused.
7. **macOS:** the first start shows the System Audio Recording prompt (and no Screen Recording prompt); refusing it makes `start()` reject with the Settings instructions; granting it makes bars move; the menu bar shows the audio-recording indicator only while a session runs. Test on 14.2, the latest release, Apple silicon and Intel.
8. **Linux:** test on PulseAudio and on PipeWire; with `parec` uninstalled `isAvailable()` is `unsupported`; the monitor of the *output* is recorded, never the microphone (play silence while speaking: the bars must stay flat).
