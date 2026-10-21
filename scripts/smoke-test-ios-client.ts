#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { audioSmokeFixture, nativeAudioSmokeBundle } from './native-audio-smoke';
import sharp from 'sharp';

const root = resolve(import.meta.dir, "..");
const generated = join(root, "ios/tauri/src-tauri/gen/apple");
const serialIndex = process.argv.indexOf("--simulator");
const simulator = process.argv[serialIndex + 1];
if (serialIndex < 0 || !simulator || simulator.startsWith("--")) throw new Error("Specify an iOS simulator UUID with --simulator.");
if (!existsSync(join(generated, "lumiverse-ios-client.xcodeproj/project.pbxproj"))) throw new Error("Build first: bun run build:ios-client --simulator --debug");
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || "/Applications/Xcode.app/Contents/Developer" };
async function run(command: string[], cwd = generated) {
  const child = Bun.spawn(command, { cwd, env, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`iOS smoke test failed: ${command.join(" ")}`);
}
// Never reset an app on a simulator that might contain the user's data.
const devices = Bun.spawn(["xcrun", "simctl", "list", "devices", "--json"], { env, stdout: "pipe", stderr: "inherit" });
const deviceList = JSON.parse(await new Response(devices.stdout).text()) as { devices: Record<string, { udid: string; name: string; state: string }[]> };
const testDevice = Object.values(deviceList.devices).flat().find(device => device.udid === simulator && device.name.startsWith("LumiverseClientSmoke"));
if (await devices.exited !== 0 || !testDevice)
  throw new Error("Use a dedicated simulator named LumiverseClientSmoke; this test resets its Lumiverse installation.");
if (testDevice.state !== "Booted") await run(["xcrun", "simctl", "boot", simulator]);
await run(["xcrun", "simctl", "bootstatus", simulator, "-b"]);
let identityVerified = false, commandsBlocked = false, restoredCookie = false, nativePermissionsVerified = false, nativeFramesBlocked = false, speechPermissionHandled = false;
let audioResult: { passed: boolean; error?: string } | undefined;
let liveActivityResult: { passed: boolean; available?: boolean; error?: string } | undefined;
const activitySmokeRequired = (Bun.YAML.parse(readFileSync(join(generated, "project.yml"), "utf8")) as any)
  .targets['lumiverse-ios-client_iOS'].info.properties.NSSupportsLiveActivities === true;
const smokeGenerationId = `smoke-${Date.now()}`;
const audioBundle = await nativeAudioSmokeBundle();
const activityAvatar = await sharp(join(root, 'frontend/public/icon.svg')).resize(128, 128).flatten({ background: '#231e30' }).jpeg().toBuffer();
const fixture = Bun.serve({ hostname: "127.0.0.1", port: 18763, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/ios-activities/v1/registrations/')) {
    if (url.pathname.endsWith('/avatar')) return new Response(activityAvatar, { headers: { 'Content-Type': 'image/jpeg' } });
    if (request.method === 'DELETE') return new Response(null, { status: 204 });
    return Response.json({ state: { phase: 'reasoning', label: 'Thinking' } });
  }
  if (url.pathname === '/activity-check' && request.method === 'POST') {
    liveActivityResult = await request.json() as typeof liveActivityResult;
    console.log('[ios] Activity probe:', JSON.stringify(liveActivityResult));
    return new Response(null, { status: 204 });
  }
  if (url.pathname === '/download-export') {
    if (!request.headers.get('Cookie')?.includes('lumiverse_ios_smoke=1')) return new Response('Unauthorized', { status: 401 });
    return new Response('{"source":"server"}', { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="server-export.json"' } });
  }
  if (url.pathname === '/audio-probe.js') return new Response(audioBundle, { headers: { 'Content-Type': 'text/javascript' } });
  if (url.pathname === '/message-received.mp3') return new Response(audioSmokeFixture(), { headers: { 'Content-Type': 'audio/wav' } });
  if (url.pathname === '/audio-check' && request.method === 'POST') {
    audioResult = await request.json() as typeof audioResult;
    return new Response(null, { status: 204 });
  }
  if (url.pathname === "/api/v1/runtime-config") return Response.json({ safeThemeMode: false });
  if (url.pathname === '/speech-denied' && request.method === 'POST') {
    speechPermissionHandled = true;
    return new Response(null, { status: 204 });
  }
  if (url.pathname === "/check" && request.method === "POST") {
    const result = await request.json() as { identityVerified: boolean; commandsBlocked: boolean; nativePermissionsVerified: boolean; nativeFramesBlocked: boolean };
    identityVerified ||= result.identityVerified;
    commandsBlocked ||= result.commandsBlocked;
    nativePermissionsVerified ||= result.nativePermissionsVerified;
    nativeFramesBlocked ||= result.nativeFramesBlocked;
    return new Response(null, { status: 204 });
  }
  if (url.pathname === '/native-frame') return new Response(`<!doctype html><script>
    (async () => {
      let blocked = false;
      try { await window.webkit.messageHandlers.lumiverseNative.postMessage({action:'notifications.status'}); }
      catch { blocked = true; }
      parent.postMessage({nativeFrameBlocked: blocked}, location.origin);
    })();</script>`, { headers: { 'Content-Type': 'text/html' } });
  if (request.method === "GET" && request.headers.get("Cookie")?.includes("lumiverse_ios_smoke=1")) restoredCookie = true;
  // Keep gesture checks on the fixture from opening WebKit's text-selection/Translate UI.
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{-webkit-user-select:none;user-select:none}</style></head><body>
    <h1>Remote Lumiverse</h1><p id="identity"></p><p id="commands"></p><p id="permissions"></p>
    <button id="export-blob">Export blob</button><button id="export-server">Export from server</button>
    <button id="speech">Try native dictation</button><p id="speech-result"></p>
    <button id="activity">Test Live Activity</button><p id="activity-result"></p>
    <button id="activity-continue" hidden>Continue Live Activity check</button>
    <p id="audio"></p><script defer src="/audio-probe.js"></script>
    <script>(async () => {
      await new Promise(resolve => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', resolve, {once:true}) : resolve());
      document.getElementById('export-blob').onclick = () => {
        const url = URL.createObjectURL(new Blob(['{"source":"blob"}'], {type:'application/json'}));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'blob-export.json';
        document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
      };
      document.getElementById('export-server').onclick = () => {
        const anchor = document.createElement('a'); anchor.href = '/download-export'; anchor.download = 'server-export.json';
        document.body.append(anchor); anchor.click(); anchor.remove();
      };
      document.getElementById('activity').onclick = async () => {
        const bridge = window.__LUMIVERSE_IOS_NATIVE__;
        let result = {passed:false};
        try {
          await bridge.request('activities.configure', {accountId:'smoke-owner', enabled:true});
          const before = await bridge.request('activities.status');
          if (!before.available) {
            if (${activitySmokeRequired}) throw new Error('Live Activities unavailable in a push-enabled simulator build');
            result = {passed:true,available:false};
          } else {
            const generationId = '${smokeGenerationId}';
            const enrollment = {registrationId:crypto.randomUUID(),credential:'s'.repeat(43),expiresAt:Date.now()+3600000,
              accountId:'smoke-owner',serverOrigin:location.origin,
              attributes:{generationId,chatId:'smoke-chat',serverOrigin:location.origin,accountId:'smoke-owner',characterName:'Lucia Flowen – Night Emissary’s Midnight Tale',startedAt:Date.now()/1000},
              state:{phase:'reasoning',label:'Thinking'}};
            const started = await bridge.request('activities.start', enrollment);
            const duplicate = await bridge.request('activities.start', enrollment);
            const active = await bridge.request('activities.status');
            if (!started.started || duplicate.started || !active.generationIds.includes(generationId)) throw new Error('Start or duplicate guard failed');
            if (!active.activities?.find(item => item.generationId === generationId)?.hasAvatar) throw new Error('Shared avatar prefetch failed');
            await bridge.request('activities.reconcile', {snapshots:[{generationId,state:{phase:'streaming',label:'Writing response'}}]});
            await bridge.request('activities.reconcile', {snapshots:[{generationId,state:{phase:'reasoning',label:'Thinking'}}]});
            let writing;
            const phaseDeadline = Date.now() + 1500;
            do {
              writing = await bridge.request('activities.status');
              if (writing.activities?.find(item => item.generationId === generationId)?.phase === 'streaming') break;
              await new Promise(resolve => setTimeout(resolve, 50));
            } while (Date.now() < phaseDeadline);
            if (writing.activities?.find(item => item.generationId === generationId)?.phase !== 'streaming') throw new Error('Phase update failed: '+JSON.stringify(writing));
            document.getElementById('activity-result').textContent = 'Live Activity preview ready';
            await new Promise(resolve => {
              const button = document.getElementById('activity-continue');
              button.hidden = false;
              button.onclick = () => { button.hidden = true; resolve(); };
            });
            await bridge.request('activities.reconcile', {snapshots:[{generationId,state:{phase:'completed',label:'Response ready'}}]});
            const ended = await bridge.request('activities.status');
            if (ended.generationIds.includes(generationId) || !ended.suppressedGenerationIds.includes(generationId)) throw new Error('Terminal recovery failed');
            await bridge.request('activities.configure', {accountId:null,enabled:false});
            result = {passed:true,available:true,avatarVerified:true,phaseUpdateVerified:true};
          }
        } catch (error) { result = {passed:false,error:String(error)}; }
        document.getElementById('activity-result').textContent = result.passed ? 'Live Activity verified' : 'Live Activity failed: '+result.error;
        await fetch('/activity-check', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
      };
      const identityVerified = window.__LUMIVERSE_MOBILE__ === true && window.__LUMIVERSE_PLATFORM__ === 'ios'
        && document.documentElement.dataset.platform === 'ios' && !document.documentElement.hasAttribute('data-tauri-desktop')
        && Object.getOwnPropertyDescriptor(window, '__LUMIVERSE_MOBILE__').writable === false;
      document.getElementById('speech').onclick = async () => {
        try { await window.__LUMIVERSE_IOS_NATIVE__.request('speech.start', {id:crypto.randomUUID(),language:'en-US'}); }
        catch (error) {
          if (String(error).includes('Speech Recognition')) {
            document.getElementById('speech-result').textContent = 'Speech permission denial handled';
            await fetch('/speech-denied', {method:'POST'});
          }
        }
      };
      let commandsBlocked = true;
      for (const [command, args] of [['mobile_connection_info', {}], ['mobile_connect', {server:'https://example.com/'}], ['plugin:fs|read_text_file', {path:'/etc/passwd'}]]) {
        try { await window.__TAURI_INTERNALS__.invoke(command, args); commandsBlocked = false; } catch {}
      }
      document.getElementById('identity').textContent = identityVerified ? 'iOS mobile identity verified' : 'Identity failed';
      document.getElementById('commands').textContent = commandsBlocked ? 'Native commands blocked' : 'Commands exposed';
      let nativePermissionsVerified = false, nativeFramesBlocked = false;
      try {
        const bridge = window.__LUMIVERSE_IOS_NATIVE__;
        const notifications = await bridge.request('notifications.status');
        const permissions = await bridge.request('permissions.status');
        let unknownBlocked = false;
        try { await bridge.request('fs.read', {path:'/etc/passwd'}); } catch { unknownBlocked = true; }
        nativePermissionsVerified = bridge.version === 1 && Object.isFrozen(bridge)
          && typeof notifications.deviceId === 'string' && notifications.bundleId === 'chat.lumiverse.ios'
          && (notifications.available === true || String(notifications.reason).startsWith('This IPA was built without Push Notifications.'))
          && ['granted','default','denied'].includes(notifications.permission)
          && ['granted','default','denied'].includes(permissions.camera)
          && ['granted','default','denied'].includes(permissions.microphone) && unknownBlocked;
        nativeFramesBlocked = await new Promise(resolve => {
          const timer = setTimeout(() => resolve(false), 5000);
          const listener = event => {
            if (event.origin !== location.origin || event.data?.nativeFrameBlocked === undefined) return;
            clearTimeout(timer); window.removeEventListener('message', listener); resolve(event.data.nativeFrameBlocked === true);
          };
          window.addEventListener('message', listener);
          const frame = document.createElement('iframe'); frame.src = '/native-frame'; frame.hidden = true; document.body.append(frame);
        });
      } catch {}
      document.getElementById('permissions').textContent = nativePermissionsVerified && nativeFramesBlocked ? 'Native permissions verified' : 'Native permissions failed';
      await fetch('/check', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identityVerified,commandsBlocked,nativePermissionsVerified,nativeFramesBlocked})});
    })();</script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": "lumiverse_ios_smoke=1; Max-Age=3600; Path=/; SameSite=Lax" } });
} });
try {
  const specPath = join(generated, "project.yml");
  let spec = readFileSync(specPath, "utf8");
  if (!spec.includes("  LumiverseClientSmoke:")) spec += `
  LumiverseClientSmoke:
    type: bundle.ui-testing
    platform: iOS
    sources: [../../../../tests]
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: chat.lumiverse.ios.smoke
        GENERATE_INFOPLIST_FILE: YES
        IPHONEOS_DEPLOYMENT_TARGET: "17.0"
    dependencies:
      - target: lumiverse-ios-client_iOS
    scheme:
      testTargets: [LumiverseClientSmoke]
`;
  spec = spec.replace(/(PRODUCT_BUNDLE_IDENTIFIER: chat\.lumiverse\.ios\.smoke\n        GENERATE_INFOPLIST_FILE: YES\n)(?!        IPHONEOS_DEPLOYMENT_TARGET:)/,
    '$1        IPHONEOS_DEPLOYMENT_TARGET: "17.0"\n');
  if (spec !== readFileSync(specPath, "utf8")) {
    writeFileSync(specPath, spec);
    await run(["xcodegen", "generate", "--spec", "project.yml"]);
  }
  // A dedicated test simulator can be reset without touching the user's devices.
  await run(["xcrun", "simctl", "terminate", simulator, "chat.lumiverse.ios"]).catch(() => {});
  await run(["xcrun", "simctl", "uninstall", simulator, "chat.lumiverse.ios"]).catch(() => {});
  await run(["xcrun", "simctl", "privacy", simulator, "reset", "all", "chat.lumiverse.ios"]);
  const out = join(root, "dist/ios"); mkdirSync(out, { recursive: true });
  const resultBundle = join(out, `smoke-${Date.now()}.xcresult`);
  await run(["xcodebuild", "-quiet", "test", "-project", "lumiverse-ios-client.xcodeproj", "-scheme", "LumiverseClientSmoke",
    "-configuration", "debug", "-destination", `platform=iOS Simulator,id=${simulator}`,
    "-derivedDataPath", join(root, ".tmp/ios-xcode/simulator"), "-resultBundlePath", resultBundle,
    // Keychain needs a signed simulator executable. Ad-hoc signing requires no
    // developer account or provisioning profile and gives the host its identity.
    "CODE_SIGNING_ALLOWED=YES", "CODE_SIGN_IDENTITY=-", "CODE_SIGNING_REQUIRED=NO", "LUMIVERSE_IOS_EXPERIMENTAL_HIGH_REFRESH=0"]);
  if (!identityVerified || !commandsBlocked || !restoredCookie || !nativePermissionsVerified || !nativeFramesBlocked || !speechPermissionHandled)
    throw new Error("The remote page did not verify native identity, command isolation, permission bridge, frame isolation, and cookie persistence.");
  if (!audioResult?.passed) throw new Error(`Native audio check failed: ${JSON.stringify(audioResult)}`);
  if (!liveActivityResult?.passed) throw new Error(`Live Activity check failed: ${JSON.stringify(liveActivityResult)}`);
  const container = Bun.spawn(["xcrun", "simctl", "get_app_container", simulator, "chat.lumiverse.ios", "data"], { env, stdout: "pipe", stderr: "inherit" });
  const dataPath = (await new Response(container.stdout).text()).trim();
  if (await container.exited !== 0) throw new Error("Could not inspect exported files.");
  for (const [filename, source] of [["blob-export.json", "blob"], ["blob-export (1).json", "blob"], ["server-export.json", "server"]]) {
    const exported = JSON.parse(readFileSync(join(dataPath, "Documents", filename!), "utf8"));
    if (exported.source !== source) throw new Error(`Incorrect exported file: ${filename}`);
  }
  const report = { passed: true, simulator, identityVerified, commandsBlocked, restoredCookie, nativePermissionsVerified, nativeFramesBlocked, speechPermissionHandled, audioResult, liveActivityResult, resultBundle, exportsVerified: true,
    checks: ["server connection", "saved address across relaunch", "two-finger controls and native share sheet", "change server", "mobile identity", "remote command isolation", "persistent WebView cookies", "native permission bridge", "native subframe isolation", "native speech authorization and denial", "notification and TTS audio without a silent primer or preceding gesture", "blob and authenticated exports in Documents, duplicate names, and persistence across relaunch", "Live Activity foreground start, duplicate guard, terminal recovery, and logout cleanup"],
    backend: "loopback fixture; live-server authentication and chat are not covered" };
  writeFileSync(join(out, "smoke-test.json"), JSON.stringify(report, null, 2) + "\n");
  console.log("[ios] Thirteen client smoke checks passed.");
} finally { fixture.stop(true); }
