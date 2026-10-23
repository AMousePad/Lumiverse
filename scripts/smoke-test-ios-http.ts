#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join, resolve } from 'node:path'

// Actual wrapper, production frontend, and isolated production backend. No model
// generation or user instance is involved. A LAN address exercises an insecure
// browser context, which localhost cannot do.
const root = resolve(import.meta.dir, '..')
const index = process.argv.indexOf('--simulator'), simulator = process.argv[index + 1]
if (index < 0 || !simulator || simulator.startsWith('--')) throw new Error('Specify --simulator UUID')
const ip = Object.values(networkInterfaces()).flat().find(value => value?.family === 'IPv4' && !value.internal)?.address
if (!ip) throw new Error('An active LAN interface is required for the non-localhost HTTP test')
const origin = `http://${ip}:18766`
const directory = mkdtempSync(join(root, '.tmp/ios-http-integration-'))
const generated = join(root, 'ios/tauri/src-tauri/gen/apple')
const frontend = join(directory, 'frontend')
cpSync(join(root, 'frontend/dist'), frontend, { recursive: true })
const env: Record<string, string | undefined> = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer' }
async function run(command: string[], capture = false) {
  const child = Bun.spawn(command, { cwd: generated, env, stdout: capture ? 'pipe' : 'inherit', stderr: 'inherit' })
  const output = capture ? await new Response(child.stdout).text() : ''
  if (await child.exited !== 0) throw new Error(`Command failed: ${command.join(' ')}`)
  return output.trim()
}
const devices = JSON.parse(await run(['xcrun', 'simctl', 'list', 'devices', '--json'], true))
const device = Object.values(devices.devices).flat().find((value: any) => value.udid === simulator) as any
if (!device?.name.startsWith('LumiverseClientSmoke')) throw new Error('Use a dedicated LumiverseClientSmoke simulator; the test resets its installation')
const backendEnv: Record<string, string> = {
  DATA_DIR: join(directory, 'data'), FRONTEND_DIR: frontend, PORT: '18766', LUMIVERSE_HOST: '0.0.0.0',
  OWNER_USERNAME: 'httpsmoke', OWNER_PASSWORD: 'http-smoke-password',
  AUTH_SECRET: 'isolated-http-integration-secret-at-least-32-characters',
  TRUSTED_ORIGINS: origin, BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(directory, 'bun-cache'),
}
for (const key of ['PATH', 'HOME', 'TMPDIR', 'DEVELOPER_DIR']) if (env[key]) backendEnv[key] = env[key]!
mkdirSync(backendEnv.DATA_DIR!, { recursive: true })
// Test-only endpoint inspects the committed widget cache while the app remains
// foreground. XCTest teardown/navigation may invalidate it after the assertion.
const entry = join(directory, 'backend.ts')
writeFileSync(entry, `
  import {readFileSync} from 'node:fs';
  const serve = Bun.serve.bind(Bun);
  Bun.serve = options => serve({...options, async fetch(request, server) {
    const path = new URL(request.url).pathname;
    if(path === '/http-smoke-widget-check') {
      try {
        const child = Bun.spawn(['xcrun','simctl','get_app_container',${JSON.stringify(simulator)},'chat.lumiverse.ios','group.chat.lumiverse.ios.widgets'], {stdout:'pipe',stderr:'pipe'});
        const container = (await new Response(child.stdout).text()).trim();
        if(await child.exited !== 0) throw new Error('Widget container unavailable');
        const snapshot = JSON.parse(readFileSync(container+'/CharacterWidgets/snapshot.json','utf8'));
        if(!snapshot.recent.length) throw new Error('Recent character snapshot missing');
        console.log('HTTP widget snapshot verified');
        return Response.json({passed:true});
      } catch(error) {console.log('HTTP widget snapshot check failed:',String(error));return Response.json({passed:false});}
    }
    const response = await options.fetch(request, server);
    if(path.startsWith('/api/ios-widgets/')) console.log('Widget HTTP',path,response.status,response.headers.get('Content-Type'));
    return response;
  }});
  await import(${JSON.stringify(join(root, 'src/index.ts'))});
`)
const backend = Bun.spawn([process.execPath, '--no-env-file', 'run', entry], {
  cwd: directory, env: backendEnv, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
})
let backendLog = ''
const drained = Promise.all([backend.stdout, backend.stderr].map(async stream => {
  for await (const chunk of stream) backendLog = (backendLog + new TextDecoder().decode(chunk)).slice(-128_000)
}))
try {
  let ready = false
  for (let attempt = 0; attempt < 300; attempt++) {
    if (backend.exitCode !== null) throw new Error('Backend exited: ' + backendLog)
    ready = await fetch(origin + '/api/v1/runtime-config').then(value => value.ok, () => false)
    if (ready) break
    await Bun.sleep(200)
  }
  assert(ready, backendLog)
  const login = await fetch(origin + '/api/auth/sign-in/username', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'httpsmoke', password: 'http-smoke-password' }) })
  assert.equal(login.status, 200, await login.clone().text())
  const cookies = login.headers.getSetCookie()
  assert(cookies.length && cookies.every(value => !/;\s*Secure(?:;|$)/i.test(value)))
  const headers = { Origin: origin, Cookie: cookies.map(value => value.split(';')[0]).join('; '), 'Content-Type': 'application/json' }
  async function post(path: string, body: unknown) {
    const response = await fetch(origin + '/api/v1' + path, { method: 'POST', headers, body: JSON.stringify(body) })
    assert(response.ok, await response.clone().text())
    return response.json() as Promise<any>
  }
  const character = await post('/characters', { name: 'HTTP Test Character', first_mes: 'HTTP transport greeting' })
  const chat = await post('/chats', { character_id: character.id, name: 'HTTP test chat' })
  // Test controls live outside the production React root; login and chat are the
  // actual shipped components. Assertions use real authenticated API/WS traffic.
  writeFileSync(join(frontend, 'http-smoke.js'), `
    const panel = document.createElement('aside');
    panel.style = 'position:fixed;bottom:0;left:0;z-index:2147483647;background:#171321;color:white;padding:6px;font:12px sans-serif';
    panel.innerHTML = '<span>HTTP context: '+(isSecureContext?'secure':'insecure')+'</span> <a href="/chat/${chat.id}">Open HTTP test chat</a> <button>Verify HTTP chat</button><p role="status"></p>';
    document.body.append(panel);
    panel.querySelector('button').onclick = async () => {
      const status = panel.querySelector('p');
      try {
        if (isSecureContext) throw new Error('Expected a non-localhost HTTP context');
        if (!/^[0-9a-f-]{36}$/.test(crypto.randomUUID())) throw new Error('UUID fallback failed');
        const session = await (await fetch('/api/auth/get-session')).json();
        if (session.user.username !== 'httpsmoke') throw new Error('Login cookie not retained');
        const response = await fetch('/api/v1/chats/${chat.id}/messages', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'HTTP user',content:'HTTP chat write verified',is_user:true})});
        if (!response.ok) throw new Error('Chat write failed');
        await new Promise((resolve,reject) => {
          const socket = new WebSocket(location.origin.replace(/^http/,'ws')+'/api/ws?heartbeat=1');
          const timer = setTimeout(() => {socket.close();reject(new Error('WebSocket timeout'));},10000);
          socket.onmessage = event => {if(JSON.parse(event.data).type==='heartbeat_ready'){clearTimeout(timer);socket.close();resolve();}};
          socket.onerror = () => {clearTimeout(timer);reject(new Error('WebSocket failed'));};
        });
        const bridge = window.__LUMIVERSE_IOS_NATIVE__;
        let native = await bridge.request('widgets.configure',{accountId:session.user.id,serverOrigin:location.origin});
        if (!native.available) throw new Error('Widget support missing');
        if (native.needsEnrollment) {
          const enrollment = await (await fetch('/api/v1/ios-widgets/registrations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:native.deviceId})})).json();
          await bridge.request('widgets.configure',{accountId:session.user.id,serverOrigin:location.origin,enrollment});
        }
        await bridge.request('widgets.refresh');
        const committed = await (await fetch('/http-smoke-widget-check')).json();
        if (!committed.passed) throw new Error('Native widget snapshot not committed');
        status.textContent = 'HTTP chat, WebSocket, and native widgets verified';
      } catch(error) {status.textContent=String(error);}
    };
  `)
  const htmlPath = join(frontend, 'index.html')
  writeFileSync(htmlPath, readFileSync(htmlPath, 'utf8').replace('</body>', '<script src="/http-smoke.js" defer></script></body>'))
  writeFileSync(join(directory, 'FixtureConfiguration.swift'), `let httpTestOrigin = ${JSON.stringify(origin)}\n`)
  const specPath = join(generated, 'project.yml')
  let spec = readFileSync(specPath, 'utf8').replace(/  # HTTP integration\n[\s\S]*?  # End HTTP integration\n/g, '')
  spec += `
  # HTTP integration
  LumiverseHTTPIntegration:
    type: bundle.ui-testing
    platform: iOS
    sources: [../../../../http-integration-tests, ${join(directory, 'FixtureConfiguration.swift')}]
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: chat.lumiverse.ios.http-integration
        GENERATE_INFOPLIST_FILE: YES
        IPHONEOS_DEPLOYMENT_TARGET: "17.0"
    dependencies:
      - target: lumiverse-ios-client_iOS
    scheme:
      testTargets: [LumiverseHTTPIntegration]
  # End HTTP integration
`
  writeFileSync(specPath, spec)
  await run(['xcodegen', 'generate', '--spec', 'project.yml'])
  if (device.state !== 'Booted') await run(['xcrun', 'simctl', 'boot', simulator])
  await run(['xcrun', 'simctl', 'bootstatus', simulator, '-b'])
  await run(['xcrun', 'simctl', 'terminate', simulator, 'chat.lumiverse.ios']).catch(() => {})
  await run(['xcrun', 'simctl', 'uninstall', simulator, 'chat.lumiverse.ios']).catch(() => {})
  const resultBundle = join(directory, 'http.xcresult')
  await run(['xcodebuild', '-quiet', 'test', '-project', 'lumiverse-ios-client.xcodeproj', '-scheme', 'LumiverseHTTPIntegration',
    '-configuration', 'release', '-destination', 'platform=iOS Simulator,id=' + simulator,
    '-derivedDataPath', join(root, '.tmp/ios-xcode/simulator-push-widgets'), '-resultBundlePath', resultBundle,
    '-parallel-testing-enabled', 'NO', 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'CODE_SIGNING_REQUIRED=NO', 'LUMIVERSE_IOS_PREBUILT_RUST=1'])
  const container = await run(['xcrun', 'simctl', 'get_app_container', simulator, 'chat.lumiverse.ios', 'data'], true)
  const connection = JSON.parse(readFileSync(join(container, 'Library/Application Support/chat.lumiverse.ios/connection.json'), 'utf8'))
  assert.equal(connection.server, origin + '/')
  assert.equal(connection.allowInsecureHttp, true)
  assert(backendLog.includes('HTTP widget snapshot verified'), 'Native widget refresh must commit the HTTP server snapshot')
  const report = { passed: true, origin, simulator, resultBundle, checks: ['explicit HTTP consent', 'production HTTP login', 'insecure browser context', 'production chat UI', 'authenticated chat write', 'cookie-authenticated WebSocket', 'native widget refresh', 'saved permission and session after relaunch'] }
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  backend.kill('SIGTERM')
  await backend.exited
  await drained
  writeFileSync(join(directory, 'backend.log'), backendLog)
}
