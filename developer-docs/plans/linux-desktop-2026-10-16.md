# Linux desktop audit and remediation plan

Date: 2026-10-16. Scope: the fully bundled nightly
`0.3.2-nightly.20261015.38664158151`, particularly CachyOS, KDE Plasma/KWin
6.7.5, Wayland, and NVIDIA RTX 2080 Ti with driver 615.78.08.

This is an investigation and implementation plan. No application behavior was
changed. The audit ran on macOS; the reported GPU failures have not been
reproduced on Linux hardware here. The referenced screenshot and complete
tester logs were not available.

## Assessment

The report exposes several interacting problems: an XWayland default, an
unreliable accelerated WebKitGTK rendering path, a fragile fixed-size setup
dialog, and browser-launch failures that leave native desktop authorization
waiting. Remote HTTPS and issuer configuration are a separate onboarding issue.

The strongest first experiment is the **intact AppImage with native Wayland and
NVIDIA explicit sync disabled together**. The tester tried each separately on
the AppImage, and tried the combination only after removing bundled libraries.
The latter also changes the runtime and is not a clean comparison.

An environment variable that prevents a crash is not sufficient to close this
issue. Typing, pointer interaction, window movement, and rendering must remain
responsive, with the accelerated path verified independently.

## Release and source evidence

The [reported release](https://github.com/prolix-oc/Lumiverse/releases/tag/desktop-v0.3.2-nightly.20261015.38664158151)
and [workflow run](https://github.com/prolix-oc/Lumiverse/actions/runs/38664158151)
identify source commit `7f0ca52529b61fa1479e76523a2667349ffe4c16`.
The audited checkout is staging commit
`9cc9f5da3aaa10474dc7cb9f31bc74a299dcd6cb`. Comparison confirms that the
Linux startup, frontend window, remote OAuth, connection dialog, Cargo lockfile,
AppImage finalizer, and smoke test examined here match the nightly. The change
in `lib.rs` since that release adds a Windows-only WebView visibility plugin.

Artifact identity from release metadata:

```text
lumiverse-desktop-linux-x86_64-0.3.2-nightly.20261015.38664158151.AppImage
size: 529914360 bytes
SHA-256: 279ba01fd4426345619fc9f0b83abcacee8ffd4d5d7505845dff6090e7ee2469
```

The [Linux build job](https://github.com/prolix-oc/Lumiverse/actions/runs/38664158151/job/116226981811)
records WebKitGTK and JavaScriptCoreGTK **2.50.4-0ubuntu0.22.04.1**, libsoup
**3.0.7-0ubuntu1**, and GTK development/introspection packages
**3.24.33-1ubuntu2.2**. The bundler copies GTK, GLib, WebKitGTK, and libsoup from
that runner. The exact GLib package revision is not established by the inspected
log; record it in future runtime manifests. The tester's system WebKitGTK,
GTK, GLib, libsoup, and egl-wayland versions remain unknown.

The log also confirms that EGL, GLX, GL dispatch, and GBM libraries are excluded
by linuxdeploy, and that our finalizer removes `libwayland-client` before
repacking. Other Wayland libraries, including `libwayland-egl` and
`libwayland-cursor`, are copied during packaging. Their compatibility with the
host boundary needs measurement; their presence alone does not prove a defect.

Locked Rust dependencies include Tauri 2.11.5, Wry 0.55.1, Tao 0.35.3,
tauri-plugin-opener 2.5.4, and open 5.4.0. These crate versions are distinct from
the native WebKitGTK engine version. WebKitGTK 4.1 denotes the GTK 3 API;
WebKitGTK 6.0 denotes the GTK 4 API and is not a replacement for this build.

## Findings and confidence

| Finding | Evidence | Assessment |
| --- | --- | --- |
| The packaged default uses X11/XWayland when both displays exist. | `desktop/src-tauri/src/lib.rs:27-69`; a test explicitly preserves this choice. Upstream linuxdeploy's GTK hook sets `GDK_BACKEND=x11`. | Confirmed policy. Native Wayland fixing the tester's geometry and move crashes supports changing it after validation. |
| The setup dialog cannot adapt to the available desktop space. | `frontend.rs:1480-1500` fixes initial/minimum/maximum size at 620×680 and disables resize. `custom-url.css:11-16` imposes 520px minimum content width and hides horizontal overflow. | Confirmed layout constraints; exact clipping mechanism needs the missing screenshot, scale factors, and actual viewport measurements. Vertical scrolling already exists. |
| There is no explicit global software-rendering override in the audited startup/bundle code. | Searches found no forced DMABUF/compositing-disable or software-rasterizer settings there. | Slowness may be renderer fallback or an inefficient presentation path, but software rendering is not proven solely by absence from nvtop/nvidia-smi. |
| System-library Wayland `Error 71` closely matches a known upstream failure. | WebKit bug 280210 and NVIDIA egl-wayland issue 179 describe explicit-sync surface commits without an acquire point. Disabling explicit sync changes the tester's result in the same direction. | Strong match, not confirmed without the tester's Wayland protocol trace. Error 71 by itself is generic. |
| The X11 client-limit crash is unresolved. | It occurs during movement on XWayland and disappears in the intact native Wayland run. No direct XOpenDisplay allocation loop was found in our desktop Rust sources. | Suspect connection/resource exhaustion in the runtime or driver path. The message does not identify which process owns the connections. |
| Deleting the bundled library directory is not a reliable system-runtime mode. | AppRun configures GTK resources, schemas, module paths, and media discovery. WebKit helper processes must match the loaded WebKit runtime. | Mixed resources/modules/helpers are plausible contributors to the NULL-instance warnings. Those warnings also admit lifecycle bugs; a stack trace is required. |
| The frontend always requests a transparent native window. | `frontend.rs:682-712`, including when the saved theme is opaque. Wayland blur uses borrowed GTK display/surface handles and runs on GTK's thread. | Transparency/compositor effects are useful isolation variables. No evidence yet makes our blur integration the cause of the click crash. Disabling theme blur alone does not create an opaque native window. |
| Browser opening cannot report eventual launcher failure. | `remote_instance.rs:716-720` and `main.ts:1008-1013` use opener. Locked opener delegates to `open::that_detached`; open spawns with inherited environment and suppresses stdout/stderr. | Confirmed observability gap. AppImage library/PATH/XDG contamination and bundled launcher selection are strong suspects for Opera, not a confirmed Opera-specific defect. |
| Desktop authorization is independent of the web session. | Native OAuth uses PKCE, a loopback listener, a native token session, and keyring storage. A WebView login does not complete that flow. | Seeing characters/chats while the tray is authorizing is consistent with the design. The desktop flow serves role-scoped status and native integrations, not just a duplicate web login. |
| The callback timeout is five minutes. | `remote_instance.rs:30,415-422`. | The report's “a few seconds later” needs timestamps relative to native authorization start. Do not reduce or extend the timeout as the primary fix. |
| The UI has an additional stuck-authorizing error path. | `main.ts:764-793` sets authorizing, then awaits `updateMenu()` before entering `try/finally`. A failure there bypasses state cleanup. | Confirmed code gap; not proof that this path caused the tester's persistent menu text. Normal invoke failures do reset the state. |
| Remote HTTPS and issuer checks are intentional. | `remote_instance.rs:191-259`; `src/auth/request-origin.ts`; `src/auth/index.ts:74-85`. | Preserve HTTPS for non-loopback origins and issuer validation. Improve setup guidance and discovery errors. |
| User-facing tray documentation contradicts current capabilities. | `user-docs/docs/getting-started/desktop-tray.md` says remote servers and bundled server/Bun are unsupported. `desktop/README.md:69-85` documents current remote setup. | Confirmed documentation defect that directly increases setup friction. |

## Upstream evidence and its limits

[Tauri's Linux graphics guide](https://v2.tauri.app/develop/debug/linux-graphics/)
documents blank/flickering windows, resize crashes, and NVIDIA-related rendering
failures. It recommends testing explicit-sync disable before disabling DMABUF
or all accelerated compositing. These flags affect different parts of the
pipeline; disabling DMABUF does not by definition disable every GPU operation.

[WebKit bug 280210](https://bugs.webkit.org/show_bug.cgi?id=280210) contains both
the matching Wayland explicit-sync signature and the X11 GBM allocation
failure. It also includes a September 2026 report of WebKitGTK 2.54.0 on KDE
with NVIDIA driver 615.71.09: disabling explicit sync prevents launch failure
but leaves severe flicker. That closely related report is a reason to validate
interactivity after any upgrade; “newer WebKit” is not a demonstrated fix.

In [NVIDIA egl-wayland issue 179](https://github.com/NVIDIA/egl-wayland/issues/179),
a maintainer explains how attaching a buffer without explicit-sync points
violates the protocol once EGL owns that surface's sync objects. The issue was
closed by its reporter to follow WebKit; that closure does not establish a fix.

[Tauri issue 10078](https://github.com/tauri-apps/tauri/issues/10078) records
AppImages built on Ubuntu failing to launch browsers on Arch/KDE, with both
bundled xdg-open behavior and inherited library paths implicated. Our locked
opener code still lacks child-environment cleanup. The proposed
[/usr/bin/xdg-open preference](https://github.com/tauri-apps/plugins-workspace/pull/2103)
was closed without merging; do not assume a dependency upgrade includes it.

The [OpenURI portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.OpenURI.html)
offers a desktop-mediated URL launch path with asynchronous request responses.
It is a candidate for the fix, with a fallback for desktops without a working
portal. A successful request still does not prove OAuth completion.

The [Tauri AppImage guide](https://v2.tauri.app/distribute/appimage/) explains the
oldest-supported-build-system constraint. Raising the Ubuntu build baseline can
raise the required glibc version. The experimental
[portable AppImage proposal](https://github.com/tauri-apps/tauri/pull/12491)
remains a draft/open proposal in the inspected upstream state; adopting it is a
separate packaging project, not an available stable fix.

## Reproduction and evidence collection

First reproduce with the exact release and a fresh profile, then repeat against
the tester's existing profile. Keep account/theme/workload constant. Close the
previous process fully between runs. Record the displayed backend and runtime
versions rather than assuming environment variables took effect.

| Order | Runtime | Backend and flags | Purpose |
| --- | --- | --- | --- |
| A0 | Intact reported AppImage | Default | Establish the original behavior. |
| A1 | Same AppImage | `LUMIVERSE_GDK_BACKEND=wayland` | Reconfirm the tester's stable but slow case. |
| A2 | Same AppImage | Native Wayland plus `__NV_DISABLE_EXPLICIT_SYNC=1` | Highest-value missing comparison; keep DMABUF/compositing enabled. |
| A3 | Same code/runtime in a diagnostic build | A2 plus a truly opaque native window and effects off | Isolate transparency/compositor effects; this diagnostic switch does not exist yet. |
| B | Same source built for the host's GTK 3/WebKitGTK 4.1 runtime | Native Wayland; explicit sync on/off | Compare coherent host libraries/helpers/resources against the bundle. |
| C | A deliberately rebuilt, coherent bundled runtime | Same A1/A2 conditions | Evaluate a runtime update independently of backend and flag changes. |
| D | Intact bundle, separate diagnostic runs | DMABUF disabled; then compositing disabled if needed | Characterize fallback behavior and performance, not a default fix. |

For A2, an engineering diagnostic command is:

```sh
APP='./lumiverse-desktop-linux-x86_64-0.3.2-nightly.20261015.38664158151.AppImage'
env -u WEBKIT_DISABLE_DMABUF_RENDERER -u WEBKIT_DISABLE_COMPOSITING_MODE \
    -u LIBGL_ALWAYS_SOFTWARE -u GALLIUM_DRIVER \
    LUMIVERSE_GDK_BACKEND=wayland __NV_DISABLE_EXPLICIT_SYNC=1 \
    "$APP" >lumiverse-wayland-nvidia.log 2>&1
```

This deliberately removes common fallback flags for comparison. It is an
experiment, not a claimed resolution or a request to modify the user's system.

Collect the following with each result:

- Exact artifact hash, source revision, invocation, actual GDK display backend,
  desktop/compositor, kernel, driver, egl-wayland version, monitor arrangement,
  resolution, scaling, and refresh rate. Distinguish native X11 from XWayland.
- Actual loaded library paths/versions for the UI, WebKitWebProcess, and
  WebKitNetworkProcess; inspect `/proc/<pid>/maps` on Linux. Capture runtime
  diagnostics for EGL/GL vendor and renderer, graphics-device access, and CPU/GPU
  behavior during an active animation. Do not infer acceleration from a WebGL
  context existing or a process list alone.
- GTK/GIO/input-method/GStreamer module and helper locations, and only the
  relevant environment variables. Avoid dumping all environment variables.
- Typing latency, scroll/animation frame times, CPU use, and hover/click behavior
  on the same representative chat. Include a minimal HTML webview to separate
  GTK/WebKit behavior from Lumiverse's UI scale, filters, and application work.
- For Error 71: a short `WAYLAND_DEBUG=1` run capturing the specific protocol
  object and violation. Review logs for private content before sharing them.
- For NULL-instance warnings: a debug-symbol build and a debugger stop at the
  first relevant GLib warning/critical (`G_DEBUG=fatal-warnings` in a dedicated
  reproduction), then a native backtrace and library map. A SIGTRAP here is an
  intentional diagnostic stop, not a new application symptom.
- For hangs: capture thread stacks without waiting for a crash. Identify which
  process stops responding. Check the first warning, not only final assertions.
- For X11 exhaustion: measure X client connections and owning PIDs before,
  during, and after repeated move/resize/show/hide cycles. Use X resource tools
  plus OS socket/process inspection; window count alone is insufficient. Check
  whether closing Lumiverse releases the connections and whether growth also
  occurs in a minimal webview. Do not ship a higher X-server client limit as a fix.
- For browser launching: compare a harmless HTTPS URL from a normal terminal
  with the same URL via the intact AppImage. Record the selected HTTP/HTTPS MIME
  handler, resolved launcher executable, exit status/stderr, working directory,
  and portal response. Test Opera both cold and already running; also test a
  second installed browser to distinguish handler and browser-specific behavior.

## Implementation sequence

### 1. Add diagnostics and controlled graphics selection

Primary files: `desktop/src-tauri/src/lib.rs`, `frontend.rs`,
`scripts/finalize-appimage.sh`, and a new Linux diagnostics/launcher module.

- Capture original launch settings before AppRun hooks rewrite them. Add an
  artifact/runtime manifest containing native library versions, build baseline,
  bundler/plugin versions, library exclusions, and build revision.
- Log the requested and actual GDK backend and effective graphics overrides,
  with their source: user, automatic policy, or compatibility mode. Include
  WebKit termination reasons and a redacted “Copy diagnostics” action.
- Establish precedence: explicit `LUMIVERSE_GDK_BACKEND`, original user
  `GDK_BACKEND`, then session-aware automatic selection. Prefer native Wayland
  for validated Wayland sessions even when `DISPLAY` exists; retain X11 for X11
  sessions and an explicit X11 escape hatch. Preserve user backend lists where
  supported. Apply changes before GTK initialization.
- Use A2 results to decide whether to set `__NV_DISABLE_EXPLICIT_SYNC=1`
  automatically for affected NVIDIA/native-Wayland configurations. Detect the
  relevant GPU/driver path, including hybrid systems; loaded NVIDIA modules alone
  do not prove the app uses that GPU. Preserve explicit user values, log the
  decision, and keep a way to opt out. Make any automatic workaround removable
  when the verified affected range changes.
- Expose explicit accelerated and compatibility choices with a restart when
  required. Keep DMABUF/compositing-disable modes as fallbacks with a visible
  performance tradeoff. Add a diagnostic opaque-at-creation path for A3.

Acceptance: A2/A3 can be compared without unpacking or deleting libraries;
actual backend/renderer evidence is available; unaffected AMD/Intel and native
X11 configurations preserve acceleration. A session hint such as
`WAYLAND_DISPLAY` must not be logged as proof of the chosen backend.

### 2. Repair external URL launching and authorization recovery

Primary files: a new native external-launch module, `remote_instance.rs`,
`desktop/src/main.ts`, and scoped Tauri permissions/capabilities as needed.

- Route native OAuth and the tray browser action through one Linux launch
  service. Audit plugin-injected external links and file-manager opening for
  equivalent failures so they do not retain a second broken launch path.
- Prefer a verified portal OpenURI request when available. Observe its
  asynchronous response, cancellation, and timeout; fall back only when
  appropriate, avoiding duplicate launches after ambiguous dispatch.
- For a process-launch fallback, resolve a host launcher using the original
  host PATH and an accessible working directory outside the AppImage mount.
  Build a **child-only** environment: restore pre-AppRun values or remove
  AppDir additions from PATH, LD_LIBRARY_PATH/LD_PRELOAD, XDG data paths, and
  GTK/GIO/GStreamer/module/schema overrides. Preserve legitimate user values,
  display variables, session D-Bus, desktop identity, locale, and activation
  context. Do not clear the entire environment or mutate the running GTK
  process to launch a browser. A hard-coded `/usr/bin/xdg-open` is insufficient.
- Capture bounded, redacted launcher failures without blocking GTK or waiting
  indefinitely for a long-lived browser process. Distinguish dispatched,
  dispatch failed, cancelled, and callback pending; exit zero alone cannot
  prove a browser appeared.
- Show native sign-in progress with Retry, Cancel, and a manual/copy link
  fallback. Keep verifier/tokens native; restrict the short-lived authorization
  URL to trusted local UI and never write it to general diagnostics.
- Move pending-state setup and menu updates inside guaranteed cleanup. Scope
  one active authorization attempt by origin and attempt ID, cancel its
  listener on cancellation/switch, and ignore late completions of old attempts.
  Retain the existing PKCE, state, nonce, issuer, and loopback protections.
- Make the tray label explain desktop authorization independently of the web
  login. Do not put the webview session cookie or OAuth access token into remote
  page JavaScript to hide the distinction.

Acceptance: both entry points open the selected browser on KDE from the intact
AppImage, with Opera cold and already running. Missing handlers, unavailable
portals, nonzero launch failures, denied authorization, and expired/cancelled
attempts show a recoverable state. No terminal path leaves “Signing in…” stuck.
Loopback callback returns the tray to connected/restricted, and keyring restore
works after restart or reports a separate persistence warning.

### 3. Make connection setup fit the desktop and explain remote requirements

Primary files: `frontend.rs:1480`, `desktop/src/custom-url.css`,
`custom-url.html`, `custom-url.ts`, and the two user desktop guides.

- Remove the fixed maximum and non-resizable policy. Choose a sensible initial
  logical size bounded by monitor work area, with a minimum that still fits a
  small scaled display. Do not conflate logical dimensions and physical pixels.
- Replace the hard content minimum with responsive sizing. Keep every option,
  error, and primary action reachable by scrolling and keyboard at high scale
  and large fonts; horizontal clipping must not hide essential content.
- Test native Wayland and XWayland at 100%, 125%, 150%, and 200%, including mixed
  DPI monitor movement and low effective resolutions. DOM-only tests do not
  validate compositor scaling.
- Put concise LAN HTTPS guidance beside the remote field and link a working
  server-side TLS/reverse-proxy example. Explain that private IP addresses
  still require HTTPS, and that the native client and WebView both need a
  trusted certificate chain with a matching hostname/IP SAN.
- On issuer mismatch, identify the selected origin, advertised issuer, trusted
  hostname setup, restart requirement, and optional `AUTH_BASE_URL` override.
  Explain trusted proxy headers only for TLS termination at a configured proxy.
  Keep certificate validation and same-origin issuer/endpoint checks intact.
- Rewrite stale user documentation to cover the built-in server, existing
  checkout, and remote instance paths, distinguishing fully bundled releases
  from checkout-only artifacts. Explain the separate desktop authorization and
  credential persistence states.

Acceptance: all three setup choices and errors remain usable without backend
environment tweaks. A LAN user can configure TLS and an approved issuer from
the documented steps without discovering requirements by trial and error.

### 4. Repair the runtime boundary using measured results

Primary files: `scripts/finalize-appimage.sh`, its verifiers,
`scripts/tauri-finalized.ts`, Linux configuration, and both build workflows.

- Preserve the fully bundled release contract. Retain the existing readable/
  executable permission checks, host Wayland-client fix, intact Bun binary
  check, bundled GStreamer plugin validation, and signing after finalization.
- Audit what actually loads across WebKit/JavaScriptCore, GTK, GLib/GIO modules,
  libsoup, GStreamer, Wayland, GLVND/EGL, and vendor drivers. Pin the build
  environment and packaging tools and publish an allowlist/denylist with reasons.
  Investigate remaining Wayland libraries individually; do not indiscriminately
  remove all native libraries or bundle NVIDIA's driver stack.
- Compare a coherent newer bundled runtime against the current one on the
  target hardware. Keep the oldest supported glibc baseline explicit. If a
  newer build OS is chosen, treat dropping older systems as a support decision;
  otherwise build the selected runtime against the supported baseline.
- A separate distro-native package can provide a coherent host-runtime path
  and useful A/B comparison, including on Arch-derived systems. A runtime mode
  that merely prepends system library paths is not sufficient: helpers,
  resources, modules, and media discovery must also agree. Do not present such
  a package as the same fully bundled artifact.
- Evaluate Flatpak or a different webview architecture only if the controlled
  comparisons cannot produce an acceptable supported runtime. Flatpak still
  uses a graphics/runtime boundary and does not itself fix WebKit explicit
  sync. A Chromium/CEF/Electron migration is a separate costed decision.

Acceptance: the chosen intact artifact passes accelerated KDE/NVIDIA tests and
the oldest-supported-system launch/media checks. No unsupported mixture of
host and bundled helpers/modules is required to use it.

### 5. Add release gates that cover the reported failures

Keep fast unit/packaging checks, but distinguish their guarantees from real
desktop validation. The current smoke test reaches `[desktop-startup] tray
ready` under Xvfb and times out after 15 seconds; it does not validate main
frontend interaction, NVIDIA, Wayland, external browser launch, or OAuth.

| Layer | Required coverage |
| --- | --- |
| Unit/process tests | Backend/override precedence, hybrid-GPU policy, child environment restoration including unset values and paths with spaces, launcher failure/timeout/cancellation, OAuth attempt cleanup and late completions. |
| Packaged automated tests | Final artifact permissions and library policy, WebKit helper consistency, existing GStreamer factories, bundled Bun integrity, software-rendered frontend load and actual click/type/scroll interaction, setup geometry/reachability, fake host launcher with recorded environment. |
| Wayland desktop automation | Nested compositor where practical for backend selection, work-area sizing, surface lifecycle, and portal behavior. It does not certify proprietary NVIDIA acceleration. |
| Real hardware gate | KDE Wayland + NVIDIA, including the reported Turing GPU/615 driver where available; AMD/Intel Wayland controls; an X11 session; mixed-DPI scaling. Confirm accelerated rendering and bounded resource growth through repeated move/resize/minimize/show cycles. |
| Auth integration gate | Intact AppImage to LAN HTTPS and a proxy-hosted instance; approved/unapproved/misadvertised origins; Opera cold/warm; handler missing; successful callback, denial, expiry, retry, cancellation, keyring unavailable, and restart restore. |

Use a representative chat for at least ten minutes and at least 100
move/resize/show/hide cycles on the failing hardware. Capture latency/frame-time
and connection-count baselines, then agree numerical performance budgets before
promoting a candidate. Require no crash, white/frozen region, repeated native
critical, or unbounded connection growth. A software fallback that merely
avoids crashes does not satisfy the reported typing-latency regression.

## Suggested changesets and rollout

1. Diagnostics/runtime manifest plus controlled backend and opaque-window
   switches. Obtain A2/A3 and clean native-runtime results before choosing the
   graphics default or rebuilding the entire runtime.
2. Unified external URL launching and cancellable, recoverable native sign-in.
   This can proceed independently of renderer diagnosis.
3. Responsive connection setup plus current remote/TLS/issuer documentation.
   This can proceed independently of renderer diagnosis.
4. Evidence-backed backend/NVIDIA policy and coherent runtime packaging change,
   with version manifest, compatibility boundaries, and hardware results.
5. Extend CI and attach hardware qualification results to the candidate nightly.
   Promote only after the intact signed artifact passes the relevant gates.

Retain explicit backend/rendering overrides in release notes as recovery tools.
Do not silently equate successful software fallback with restored performance.
Until a candidate passes, the tester's native browser remains the demonstrated
responsive option; the native-Wayland AppImage is only the demonstrated stable
desktop option and remains slow.

## Verification performed during this audit

```sh
bun --no-env-file test \
  scripts/appimage-packaging.test.ts scripts/tauri-finalized.test.ts \
  desktop/tests/instance-connection.test.ts desktop/tests/custom-url-ui.test.ts \
  scripts/desktop-session-restoration.test.ts frontend/src/theme/linuxUiScale.test.ts

bun --no-env-file test src/auth/request-origin.test.ts
```

Results: **58 passed, 1 skipped, 0 failed** across seven files. The skipped test
requires real SquashFS tooling. The portable packaging tests use fixtures;
connection UI tests use JSDOM and cannot establish real GTK geometry. These
results validate existing contracts and the audit's interpretation of origin
handling, not resolution of the Linux runtime defects.

Still needed: the screenshot, exact system library/egl-wayland versions, A2
results, actual loaded-runtime evidence, browser-launch stderr/portal results,
and first-failure native/protocol traces. None of these unknowns prevents work
on the confirmed layout, launch observability, auth cleanup, and documentation
gaps.
