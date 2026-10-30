import { afterEach, expect, test } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import config from '../vite.config'

let fixture: string | undefined
afterEach(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true })
  fixture = undefined
})

test('shared frontend source uses the frontend Spindle package when the backend copy is older', async () => {
  fixture = mkdtempSync(join(tmpdir(), 'lumiverse-shared-dependencies-'))
  const frontend = join(fixture, 'frontend')
  const shared = join(fixture, 'src/shared')
  mkdirSync(shared, { recursive: true })
  for (const file of ['connection-organization.ts', 'connection-library.ts', 'connection-recents.ts']) {
    copyFileSync(resolve(import.meta.dirname, '../../src/shared', file), join(shared, file))
  }
  for (const [root, source] of [
    [fixture, 'export const olderPackage = true'],
    [frontend, "export const SPINDLE_CONNECTION_ORGANIZATION_HOST_CAPABILITIES = Object.freeze({ 'connection-organization-v1': 1 })"],
  ] as const) {
    const pkg = join(root, 'node_modules/lumiverse-spindle-types')
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'lumiverse-spindle-types', type: 'module', exports: './index.js' }))
    writeFileSync(join(pkg, 'index.js'), source)
  }
  const entry = join(frontend, 'entry.ts')
  writeFileSync(entry, "export { CONNECTION_ORGANIZATION_CAPABILITIES } from '../src/shared/connection-organization'")

  const result = await build({
    configFile: false,
    root: frontend,
    resolve: config.resolve,
    logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry, formats: ['es'] } },
  })
  const builds = Array.isArray(result) ? result : [result]
  const chunk = builds.flatMap(item => 'output' in item ? item.output : []).find(item => item.type === 'chunk')
  expect(chunk?.type === 'chunk' && chunk.code).toContain('connection-organization-v1')
})
