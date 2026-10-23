import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const script = readFileSync(new URL('../ios/native/src/mobile-init.js', import.meta.url), 'utf8')

test('older frontends receive cryptographically random UUIDs on HTTP without a secure-context override', () => {
  const dom = new JSDOM('', { url: 'http://192.168.1.2:8000', runScripts: 'outside-only' })
  try {
    Object.defineProperty(dom.window.crypto, 'randomUUID', { configurable: true, value: undefined })
    Object.defineProperty(dom.window, 'isSecureContext', { configurable: true, value: false })
    dom.window.eval(script)
    const ids = Array.from({ length: 100 }, () => dom.window.crypto.randomUUID())
    expect(new Set(ids).size).toBe(100)
    expect(ids.every(id => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))).toBe(true)
    expect(dom.window.isSecureContext).toBe(false)
    expect(dom.window.crypto.subtle).toBeUndefined()
  } finally { dom.window.close() }
})

test('the wrapper preserves a browser-provided UUID implementation', () => {
  const dom = new JSDOM('', { url: 'https://server.example', runScripts: 'outside-only' })
  try {
    const native = dom.window.crypto.randomUUID
    dom.window.eval(script)
    expect(dom.window.crypto.randomUUID).toBe(native)
  } finally { dom.window.close() }
})
