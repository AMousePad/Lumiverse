---
title: Experimental Lumiverse Desktop
---

# Experimental Lumiverse Desktop

Lumiverse Desktop opens Lumiverse in an integrated native browser and keeps
server controls, connection status and updates in the macOS menu bar, Windows
notification area or Linux StatusNotifier tray. Choose a built-in server, an
existing checkout or a remote HTTPS instance.

## Download and install

Download the architecture-matched desktop installer from the official
[Lumiverse releases](https://github.com/prolix-oc/Lumiverse/releases). Stable and
nightly desktop releases include the server and its Bun runtime. They do not
require a checkout, an installed Bun runtime or Rust.

| Platform | Release format |
| --- | --- |
| macOS Apple Silicon / Intel | `.dmg` |
| Windows x64 / ARM64 | NSIS `.exe` |
| Linux x86_64 / aarch64 | `.AppImage` |

Feature-branch artifacts from the
[Build Desktop workflow](https://github.com/prolix-oc/Lumiverse/actions/workflows/desktop-build.yml)
can be checkout-only companions. Their existing-checkout path requires Bun
1.4.4 or later, the checkout and its dependencies. Source builds also require
Rust and the native build libraries in the [desktop README](https://github.com/prolix-oc/Lumiverse/blob/staging/desktop/README.md#source-build-prerequisites).

Windows requires WebView2. Official Linux AppImages bundle GTK 3, WebKitGTK 4.1
and GStreamer media plugins; do not delete bundled libraries or install
WebKitGTK 6.0 as a substitute. An unpackaged binary or distro-native package
uses its matching system runtime. GNOME needs an AppIndicator/KStatusNotifier
extension for the tray; KDE displays it natively.

On Linux, mark the downloaded file executable and run it:

```sh
chmod +x Lumiverse*.AppImage
./Lumiverse*.AppImage
```

If FUSE is unavailable, use the AppImage runtime's fallback:

```sh
APPIMAGE_EXTRACT_AND_RUN=1 ./Lumiverse*.AppImage
```

Windows installers may produce SmartScreen warnings; macOS builds may use
ad-hoc signing without notarization. Use official downloads you trust.

## Connect Lumiverse Desktop to Lumiverse

On first launch, select a connection. Later, use **Browser → Instance
Connection…**. This resizable window scrolls on smaller or scaled displays.

- **Built-in server:** create the owner account, select storage and review the
  settings in the first-run wizard. Desktop manages the bundled server.
- **Existing checkout:** choose the Lumiverse folder containing
  `scripts/runner.ts`. This uses that folder's configuration, accounts and data
  and requires installed Bun. Desktop observes an already-running server
  without taking ownership of it.
- **Remote instance:** enter its HTTPS origin and complete desktop authorization
  in the system browser. No local server starts in this mode.

**Start Local Server at Launch** controls automatic startup. **Launch at Login**
registers the desktop app as a login item. Quitting stops only the server
processes Desktop owns. Closing the integrated browser closes its floating
widgets, while the tray stays available.

### Connect to a remote instance

1. Configure HTTPS for the server. LAN/private IP addresses also require HTTPS;
   HTTP is allowed only for loopback development such as `http://localhost:7860`.
2. Use a certificate chain trusted by both the native desktop client and its
   WebView. The certificate must contain the chosen DNS name or IP address in
   its Subject Alternative Names. Trusting a browser warning alone does not
   configure the native client's certificate trust.
3. Add the exact origin, including a non-default port, under **Settings →
   Operator → Trusted Hostnames**, then restart the server.
4. Choose **Remote instance** under **Browser → Instance Connection…**. Enter
   that origin and save. Use **Browser → Authorize Desktop…** to sign in again.

For example, a server with a trusted certificate for `chat.home.arpa` can
terminate TLS directly:

```dotenv
PORT=7860
LUMIVERSE_TLS_CERT_FILE=/etc/lumiverse/tls/fullchain.pem
LUMIVERSE_TLS_KEY_FILE=/etc/lumiverse/tls/privkey.pem
```

Point `chat.home.arpa` to the server on your LAN, provision a certificate for
that name, and install its issuing CA in each client's trust store if it is
private. Add `https://chat.home.arpa:7860` to Trusted Hostnames, restart, then
select that same origin in Desktop. See [direct HTTPS configuration](installation.md#direct-tls-and-custom-certificates)
and [Tailscale remote access](tailscale.md) for more setup options.

A reverse proxy may manage TLS instead. Preserve the incoming `Host`. If it
replaces that header, forward `X-Forwarded-Host` and `X-Forwarded-Proto` and set
`TRUSTED_PROXIES` to the proxy IP/CIDR in the backend environment. For a proxy
on the same machine, that might be `127.0.0.1`. These forwarded headers are
needed only when TLS terminates at a configured proxy.

If discovery reports a different OAuth issuer, compare the selected origin
with the advertised issuer. Check Trusted Hostnames and restart the server.
Remove or correct a conflicting `AUTH_BASE_URL` override; it is optional and
selects one canonical auth origin. Desktop keeps certificate validation and
same-origin issuer and endpoint checks enabled.

### Desktop authorization and browser login

The integrated browser's login controls its web session. Desktop separately
uses authorization-code PKCE for native status and integrations. Seeing chats
in the browser does not mean that native authorization completed.

The local authorization window shows progress, **Retry**, **Cancel**, and a
private temporary link to copy manually if no browser appears. Complete
consent in that system browser within five minutes. Retry starts a new attempt;
cancelling or changing instances closes the previous callback listener. No
access token or PKCE verifier is passed into the remote WebView.

The operating system credential store retains the refresh credential. If it is
locked or unavailable, Desktop reports a separate persistence warning: the
current session can work, but a restart may require sign-in again. The tray
restores saved credentials when available. Explicit remote sign-out removes
the saved credential; switching to local retains it.

All accounts can see instance identity and their own role. Server status is
restricted to administrators and owners. Local server and checkout controls
are disabled while a remote instance is selected.

## Menu and updates

- **Start Server / Stop Server** controls Desktop's local server.
- **Browser** opens, closes or reloads the integrated browser, opens the system
  browser, changes the connection and manages desktop authorization.
- **Serving Stats** reports the port, PID, uptime, branch and version when allowed.
- **Check for Updates / Apply Update** updates an existing checkout through Git.
- **Desktop Updates** installs a signed update of the entire bundled app after
  you choose **Update and restart**.
- **Open Lumiverse Data Folder** opens the selected local server's storage.

Back up or export data before removing it. A checkout keeps its server data in
that folder or its configured `DATA_DIR`. The built-in server uses app-managed
storage unless you chose another location; use **Open Lumiverse Data Folder**
to find it. Uninstalling the app does not transfer or automatically erase this
data. Disable **Launch at Login**, quit, and remove the app using your platform's
normal uninstall process. Bun and Rust installed for checkout/source work are
shared tools and can be kept for other projects.

## Linux graphics and browser troubleshooting

Use **Browser → Linux Graphics & Diagnostics…** to choose a backend/rendering
mode, create opaque diagnostic windows or copy a redacted runtime report.
Changes take effect after quitting and reopening Desktop. Explicit launch
environment values take priority over saved choices.

The automatic policy starts natively when only Wayland is available. If the
desktop also provides XWayland, test **Native Wayland** explicitly. For NVIDIA,
test **disable explicit sync only** before the slower DMABUF/compositing
compatibility modes. These modes are recovery and diagnostic choices; a stable
software fallback does not establish restored graphics performance.

Equivalent engineering launch controls are:

```sh
LUMIVERSE_GDK_BACKEND=wayland __NV_DISABLE_EXPLICIT_SYNC=1 ./Lumiverse.AppImage
LUMIVERSE_GDK_BACKEND=x11 ./Lumiverse.AppImage
LUMIVERSE_LINUX_OPAQUE=1 ./Lumiverse.AppImage
```

If a system browser does not appear, check the desktop's HTTP/HTTPS default
handler. Desktop tries the OpenURI portal, then a host launcher when no portal
request was dispatched. A cancelled or ambiguous portal request does not
silently launch a second browser. Use the manual sign-in link or Retry.

Official AppImages include their GStreamer audio plugins. Installing host
plugins does not repair an older incomplete bundle; download a current build.
Distro-native packages and raw binaries need their own matching GTK/WebKitGTK
and GStreamer base/good runtime packages.
