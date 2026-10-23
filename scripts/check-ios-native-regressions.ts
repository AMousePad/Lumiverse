#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const simulator = process.argv[process.argv.indexOf('--simulator') + 1]
if (!process.argv.includes('--simulator') || !simulator || simulator.startsWith('--'))
  throw new Error('Specify an iOS simulator UUID with --simulator.')
const directory = resolve(root, '.tmp/ios-native-regressions')
mkdirSync(directory, { recursive: true })
const specification = {
  name: 'LumiverseNativeRegressions',
  options: { deploymentTarget: { iOS: '17.0' } },
  settings: { base: { SWIFT_VERSION: '5.0', GENERATE_INFOPLIST_FILE: true,
    CODE_SIGNING_ALLOWED: 'YES', CODE_SIGN_IDENTITY: '-', CODE_SIGNING_REQUIRED: 'NO' } },
  targets: {
    NativeRegressionHost: {
      type: 'application', platform: 'iOS',
      sources: [resolve(root, 'ios/native-regression-tests/Host')],
      settings: { base: { PRODUCT_BUNDLE_IDENTIFIER: 'chat.lumiverse.native-regression-host' } },
    },
    NativeRegressions: {
      type: 'bundle.unit-test', platform: 'iOS',
      sources: [{ path: resolve(root, 'ios/native-regression-tests'), excludes: ['Host'] },
        ...['LiveActivityHandoff', 'WebViewRendering'].map(file => resolve(root, `ios/native/ios/Sources/${file}.swift`))],
      dependencies: [{ target: 'NativeRegressionHost' }],
      settings: { base: { PRODUCT_BUNDLE_IDENTIFIER: 'chat.lumiverse.native-regressions' } },
      scheme: { testTargets: ['NativeRegressions'] },
    },
  },
}
writeFileSync(resolve(directory, 'project.yml'), JSON.stringify(specification, null, 2))
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer' }
const resultBundle = resolve(directory, `native-${Date.now()}.xcresult`)
for (const command of [
  ['xcodegen', 'generate', '--spec', 'project.yml'],
  ['xcodebuild', '-quiet', '-project', 'LumiverseNativeRegressions.xcodeproj', '-scheme', 'NativeRegressions',
    '-destination', `platform=iOS Simulator,id=${simulator}`, '-derivedDataPath', 'derived',
    '-resultBundlePath', resultBundle, '-parallel-testing-enabled', 'NO', 'test'],
]) {
  const child = Bun.spawn(command, { cwd: directory, env, stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited !== 0) throw new Error('iOS native regression check failed')
}
const report = Bun.spawn(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary', '--path', resultBundle],
  { env, stdout: 'pipe', stderr: 'inherit' })
const summary = JSON.parse(await new Response(report.stdout).text())
if (await report.exited !== 0 || summary.result !== 'Passed' || summary.passedTests !== 3 || summary.skippedTests !== 0)
  throw new Error('The three native regressions must actually execute and pass')
const out = resolve(root, 'dist/ios')
mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, 'native-regressions.json'), JSON.stringify({ ...summary, resultBundle }, null, 2) + '\n')
console.log('[ios] Native handoff, expiration, and rendered text regressions passed.')
