#!/usr/bin/env bun
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { inlineProbeShell } from './ios-native-cache-probe-assets'

const root = resolve(import.meta.dir, '..')
const output = join(root, '.tmp/ios-native-cache-probe')
const index = process.argv.indexOf('--simulator')
const simulator = process.argv[index + 1]
if (index < 0 || !simulator || simulator.startsWith('--')) throw new Error('Specify --simulator with a dedicated LumiverseClientSmoke simulator UUID.')
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer',
  VITE_BUILD_ID: process.env.VITE_BUILD_ID || `native-cache-probe-${Date.now()}` }
async function run(command: string[], cwd = root) {
  const child = Bun.spawn(command, { cwd, env, stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited !== 0) throw new Error(`Native cache probe failed: ${command.join(' ')}`)
}
const list = Bun.spawn(['xcrun', 'simctl', 'list', 'devices', '--json'], { env, stdout: 'pipe', stderr: 'inherit' })
const devices = JSON.parse(await new Response(list.stdout).text()) as { devices: Record<string, { udid: string; name: string; isAvailable: boolean }[]> }
if (await list.exited !== 0 || !Object.values(devices.devices).flat().some(d => d.udid === simulator && d.isAvailable && d.name.startsWith('LumiverseClientSmoke')))
  throw new Error('Use an available, dedicated simulator named LumiverseClientSmoke. This installs a separate test app.')
mkdirSync(output, { recursive: true })
// Build into scratch space; never replace the normal PWA distribution.
// Vite accepts HTTP bases, but normalizes a custom-scheme base to '/'. Build
// using a unique placeholder, then rebase only those emitted references.
const placeholder = '/__lumiverse_native_cache_probe__/'
await run([process.execPath, 'node_modules/vite/bin/vite.js', 'build', '--base', placeholder, '--outDir', join(output, 'frontend'), '--emptyOutDir'], join(root, 'frontend'))
function rebase(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) rebase(path)
    else if (/\.(html|js|css|json)$/.test(entry.name)) {
      const source = readFileSync(path, 'utf8')
      writeFileSync(path, source.replaceAll(placeholder, 'lumiverse-cache://bundle/'))
    }
  }
}
rebase(join(output, 'frontend'))
// The custom-scheme candidate fails on HTTPS on some WebKit versions. Test a
// second public-API candidate without changing the server's document origin.
const supplied = join(output, 'supplied')
await run([process.execPath, 'node_modules/vite/bin/vite.js', 'build', '--config', 'vite.native-cache-probe.config.ts', '--outDir', supplied, '--emptyOutDir'], join(root, 'frontend'))
writeFileSync(join(output, 'frontend/supplied.html'), inlineProbeShell(supplied))
const workers = Object.fromEntries(readdirSync(join(supplied, 'assets'))
  .filter(name => /\.(worker|worklet)-.*\.js$/.test(name))
  .map(name => [name.split(/\.(worker|worklet)-/)[0]!, readFileSync(join(supplied, 'assets', name), 'utf8')]))
writeFileSync(join(output, 'frontend/workers.json'), JSON.stringify(workers))
await run(['xcodegen', 'generate', '--spec', 'ios/cache-probe/project.yml'])
const results = join(output, `results-${Date.now()}.xcresult`)
await run(['xcodebuild', '-quiet', '-project', join(root, 'ios/cache-probe/LumiverseNativeCacheProbe.xcodeproj'), '-scheme', 'NativeCacheTests', '-destination', `platform=iOS Simulator,id=${simulator}`, '-derivedDataPath', join(output, 'derived'), '-resultBundlePath', results, 'test'])
console.log(`Native cache probe passed. Test results and attachments: ${results}`)
