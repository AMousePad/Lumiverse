import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { inlineProbeShell } from './ios-native-cache-probe-assets'

/** Prepare the bundled client for the opt-in, real-server IPA preview. */
export async function buildIOSNativeCache() {
  const root = resolve(import.meta.dir, '..')
  const output = join(root, '.tmp/ios-native-cache-preview')
  const compiled = join(root, '.tmp/ios-native-cache-preview-build')
  const buildId = `ios-cache-preview-${Date.now()}`
  const child = Bun.spawn([process.execPath, 'node_modules/vite/bin/vite.js', 'build', '--config', 'vite.native-cache-probe.config.ts', '--outDir', compiled, '--emptyOutDir'], {
    cwd: join(root, 'frontend'), env: { ...process.env, VITE_BUILD_ID: buildId }, stdout: 'inherit', stderr: 'inherit',
  })
  if (await child.exited !== 0) throw new Error('Native cached frontend build failed.')
  const html = inlineProbeShell(compiled)
  const bytes = Buffer.from(html)
  const { version } = JSON.parse(readFileSync(join(root, 'frontend/package.json'), 'utf8')) as { version: string }
  const manifest = { schemaVersion: 1, buildId, appVersion: version, bytes: bytes.length,
    sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex') }
  if (manifest.bytes > 24 * 1024 * 1024) throw new Error('Native shell exceeds the preview bundle limit.')
  mkdirSync(output, { recursive: true })
  writeFileSync(join(output, 'native-shell.html'), bytes)
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

if (import.meta.main) console.log(await buildIOSNativeCache())
