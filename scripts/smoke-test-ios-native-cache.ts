#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const generated = join(root, 'ios/tauri/src-tauri/gen/apple')
const index = process.argv.indexOf('--simulator')
const simulator = process.argv[index + 1]
if (index < 0 || !simulator || simulator.startsWith('--')) throw new Error('Specify --simulator UUID.')
if (!existsSync(join(root, 'dist/ios/Lumiverse-simulator-native-cache-preview-push.app')))
  throw new Error('Build first: bun run build:ios-client --simulator --debug --push-notifications --native-cache-preview')
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer' }
async function run(command: string[], capture = false) {
  const child = Bun.spawn(command, { cwd: generated, env, stdout: capture ? 'pipe' : 'inherit', stderr: 'inherit' })
  const output = capture ? await new Response(child.stdout).text() : ''
  if (await child.exited !== 0) throw new Error(`Command failed: ${command.join(' ')}`)
  return output.trim()
}
const devices = JSON.parse(await run(['xcrun', 'simctl', 'list', 'devices', '--json'], true)) as { devices: Record<string, { udid: string; name: string }[]> }
if (!Object.values(devices.devices).flat().some(device => device.udid === simulator && device.name.startsWith('LumiverseClientSmoke')))
  throw new Error('Use a dedicated simulator named LumiverseClientSmoke; this test resets its Lumiverse installation.')

let offline = false, offlineRequests = 0, runtimeRequests = 0
const fixture = Bun.serve({ hostname: '127.0.0.1', port: 18765, fetch(request) {
  const url = new URL(request.url)
  if (url.pathname === '/__offline') { offline = url.searchParams.get('value') === '1'; return new Response(null, { status: 204 }) }
  if (offline) { offlineRequests++; return new Response('Backend unavailable', { status: 503 }) }
  if (url.pathname === '/api/v1/runtime-config') { runtimeRequests++; return Response.json({ safeThemeMode: false }) }
  if (url.pathname === '/api/auth/get-session') return Response.json(null)
  if (url.pathname === '/api/v1/sso-providers/login-options') return Response.json([])
  if (url.pathname.startsWith('/api/')) return Response.json({ error: 'Fixture endpoint' }, { status: 404 })
  return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><h1>Server frontend fixture</h1>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
} })
try {
  const specPath = join(generated, 'project.yml')
  const spec = readFileSync(specPath, 'utf8')
  if (!spec.includes('  LumiverseNativeCacheIntegration:')) {
    writeFileSync(specPath, spec + `
  LumiverseNativeCacheIntegration:
    type: bundle.ui-testing
    platform: iOS
    sources: [../../../../cache-integration-tests]
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: chat.lumiverse.ios.cache-integration
        GENERATE_INFOPLIST_FILE: YES
        IPHONEOS_DEPLOYMENT_TARGET: "17.0"
    dependencies:
      - target: lumiverse-ios-client_iOS
    scheme:
      testTargets: [LumiverseNativeCacheIntegration]
`)
    await run(['xcodegen', 'generate', '--spec', 'project.yml'])
  }
  await run(['xcrun', 'simctl', 'boot', simulator]).catch(() => {})
  await run(['xcrun', 'simctl', 'bootstatus', simulator, '-b'])
  await run(['xcrun', 'simctl', 'terminate', simulator, 'chat.lumiverse.ios']).catch(() => {})
  await run(['xcrun', 'simctl', 'uninstall', simulator, 'chat.lumiverse.ios']).catch(() => {})
  const results = join(root, '.tmp/ios-native-cache-integration'); mkdirSync(results, { recursive: true })
  const resultBundle = join(results, `results-${Date.now()}.xcresult`)
  await run(['xcodebuild', 'test', '-project', 'lumiverse-ios-client.xcodeproj', '-scheme', 'LumiverseNativeCacheIntegration',
    '-configuration', 'debug', '-destination', `platform=iOS Simulator,id=${simulator}`,
    '-derivedDataPath', join(root, '.tmp/ios-xcode/simulator-native-cache-preview-push'), '-resultBundlePath', resultBundle,
    'CODE_SIGNING_ALLOWED=NO', 'LUMIVERSE_IOS_PREBUILT_RUST=1', 'LUMIVERSE_IOS_EXPERIMENTAL_HIGH_REFRESH=0'])
  const container = await run(['xcrun', 'simctl', 'get_app_container', simulator, 'chat.lumiverse.ios', 'data'], true)
  const health = JSON.parse(readFileSync(join(container, 'Library/Application Support/NativeCache/status.json'), 'utf8'))
  if (!health.active || !health.healthy || health.origin !== 'http://127.0.0.1:18765' || !offlineRequests || !runtimeRequests)
    throw new Error(`Native cache integration evidence incomplete: ${JSON.stringify({ health, offlineRequests, runtimeRequests })}`)
  const report = { passed: true, simulator, health, offlineRequests, runtimeRequests, resultBundle,
    checks: ['actual wrapper connection', 'cached production login', 'native reload', 'saved server with unavailable backend', 'server frontend fallback', 're-enable cache', 'cold process native health acknowledgement'] }
  writeFileSync(join(results, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log('[ios] Actual wrapper native cache integration checks passed.')
} finally { fixture.stop(true) }
