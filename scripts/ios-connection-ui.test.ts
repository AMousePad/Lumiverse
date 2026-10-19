import { afterEach, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const html = readFileSync(new URL('../ios/tauri/ui/index.html', import.meta.url), 'utf8')
const script = readFileSync(new URL('../ios/tauri/ui/connection.js', import.meta.url), 'utf8')
const windows: JSDOM[] = []

afterEach(() => {
  for (const dom of windows.splice(0)) dom.window.close()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function connectionPage(query = '') {
  const saved = deferred<{ server: string | null }>()
  const connected = deferred<void>()
  const invoke = mock((command: string) => command === 'mobile_connection_info' ? saved.promise : connected.promise)
  const dom = new JSDOM(html, { url: `https://tauri.localhost/index.html${query}`, runScripts: 'outside-only' })
  windows.push(dom)
  Object.assign(dom.window, { __TAURI_INTERNALS__: { invoke } })
  dom.window.eval(`(() => {\n${script}\n})()`)
  const element = <T extends HTMLElement>(id: string) => dom.window.document.getElementById(id) as T
  return {
    dom, saved, connected, invoke,
    setup: element('connection-setup'),
    visibleContent: () => [...dom.window.document.querySelectorAll('main img, main h1, main p, main form')]
      .filter(element => !element.closest('[hidden]')),
    server: element<HTMLInputElement>('server'),
    button: element<HTMLButtonElement>('connect'),
    status: element('status'),
  }
}

async function flush() { await Promise.resolve(); await Promise.resolve() }

test('startup stays visually empty while restoring and reconnecting a saved server', async () => {
  const page = connectionPage()
  expect(page.setup.hidden).toBe(true)
  expect(page.visibleContent()).toHaveLength(0)

  page.saved.resolve({ server: 'https://my-server.example/' })
  await flush()

  expect(page.invoke).toHaveBeenCalledWith('mobile_connect', { server: 'https://my-server.example/', restore: true })
  expect(page.setup.hidden).toBe(true)
  expect(page.visibleContent()).toHaveLength(0)
  expect(page.server.disabled).toBe(true)
  page.connected.resolve()
  await flush()
  expect(page.setup.hidden).toBe(true)
  expect(page.visibleContent()).toHaveLength(0)
})

test('first launch reveals setup after determining that no server is configured', async () => {
  const page = connectionPage()
  page.saved.resolve({ server: null })
  await flush()

  expect(page.setup.hidden).toBe(false)
  expect(page.server.disabled).toBe(false)
  expect(page.invoke).toHaveBeenCalledTimes(1)
})

test('Change server reveals the saved address without reconnecting', async () => {
  const page = connectionPage('?changeServer=1')
  page.saved.resolve({ server: 'https://my-server.example/' })
  await flush()

  expect(page.server.value).toBe('https://my-server.example/')
  expect(page.setup.hidden).toBe(false)
  expect(page.invoke).toHaveBeenCalledTimes(1)
})

test('a failed reconnect reveals the saved address and a usable retry form', async () => {
  const page = connectionPage()
  page.saved.resolve({ server: 'https://my-server.example/' })
  await flush()
  page.connected.reject(new Error('Server unavailable'))
  await flush()

  expect(page.setup.hidden).toBe(false)
  expect(page.status.textContent).toBe('Server unavailable')
  expect(page.server.value).toBe('https://my-server.example/')
  expect(page.server.disabled).toBe(false)
  expect(page.button.disabled).toBe(false)
})

test('failure reading saved settings reveals setup with an explanation', async () => {
  const page = connectionPage()
  page.saved.reject(new Error('Settings unavailable'))
  await flush()

  expect(page.setup.hidden).toBe(false)
  expect(page.status.textContent).toContain('Could not restore the saved server address')
})
