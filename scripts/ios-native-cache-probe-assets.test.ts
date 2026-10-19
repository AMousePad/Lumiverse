import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inlineProbeShell } from './ios-native-cache-probe-assets'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function fixture(files: Record<string, string | Uint8Array>) {
  const root = mkdtempSync(join(tmpdir(), 'ios-cache-probe-'))
  directories.push(root)
  mkdirSync(join(root, 'assets'))
  for (const [name, source] of Object.entries(files)) writeFileSync(join(root, name), source)
  return root
}

test('supplies executable assets and fonts inline and creates worker blobs', () => {
  const root = fixture({
    'index.html': '<script type="module" crossorigin src="/assets/app.js"></script><link rel="stylesheet" crossorigin href="/assets/app.css"><link rel="modulepreload" href="/assets/unused.js"><link rel="manifest" href="/manifest.json">',
    'assets/app.js': 'const w = new Worker(new URL("/assets/worker.js", import.meta.url)); const s = "</script>";',
    'assets/worker.js': 'postMessage("cached")',
    'assets/app.css': '@font-face{src:url("/assets/font.woff2")}body{--text:"</style>"}',
    'assets/font.woff2': new Uint8Array([1, 2, 3]),
  })
  const html = inlineProbeShell(root)
  expect(html).toContain('URL.createObjectURL(new Blob(')
  expect(html).toContain(Buffer.from('postMessage("cached")').toString('base64'))
  expect(html).toContain('data:font/woff2;base64,AQID')
  expect(html).toContain('<\\/script>')
  expect(html).toContain('<\\/style>')
  expect(html).not.toContain('src="/assets/')
  expect(html).not.toContain('rel="modulepreload"')
  expect(html).not.toContain('rel="manifest"')
})

test('rejects application chunks that still import another file', () => {
  const root = fixture({
    'index.html': '<script type="module" src="/assets/app.js"></script>',
    'assets/app.js': 'import { value } from "./other.js"; window.value = value;',
  })
  expect(() => inlineProbeShell(root)).toThrow('self-contained application chunk')
})

test('rejects unresolved executable URLs instead of silently requiring a server', () => {
  const root = fixture({ 'index.html': '<script type="module" src="https://server.example/assets/app.js"></script>' })
  expect(() => inlineProbeShell(root)).toThrow('Unresolved executable probe resources')
})

test('rejects workers with unresolved imports before creating a blob URL', () => {
  const root = fixture({
    'index.html': '<script type="module" src="/assets/app.js"></script>',
    'assets/app.js': 'new Worker("/assets/worker.js");',
    'assets/worker.js': 'import "./missing.js";',
  })
  expect(() => inlineProbeShell(root)).toThrow('self-contained workers and worklets')
})

test('rejects file references outside the build', () => {
  const root = fixture({
    'index.html': '<script type="module" src="/assets/app.js"></script>',
    'assets/app.js': 'const w = new Worker("/assets/../../secret.js");',
  })
  expect(() => inlineProbeShell(root)).toThrow('escapes its build')
})
