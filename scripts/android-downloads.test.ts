import { afterEach, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

const script = await Bun.file(new URL('../android/tauri/src-tauri/src/downloads.js', import.meta.url)).text()
const windows: JSDOM[] = []
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close() })

function fixture(failChunk = false, legacyBlob = false, autoReply = true) {
  const dom = new JSDOM('<!doctype html>', { url: 'https://lumiverse.example/', runScripts: 'outside-only' })
  windows.push(dom)
  const messages: { id: string; action: string; payload: any }[] = []
  const chunks: Uint8Array[] = []
  let complete!: () => void
  const done = new Promise<void>(resolve => { complete = resolve })
  const bridge = {
    onmessage: undefined as undefined | ((event: { data: string }) => void),
    postMessage(raw: string) {
      const request = JSON.parse(raw)
      messages.push(request)
      if (request.action === 'chunk') chunks.push(Buffer.from(request.payload.data, 'base64'))
      if (!autoReply) return
      queueMicrotask(() => {
        bridge.onmessage?.({ data: JSON.stringify({ id: request.id, result: request.action === 'begin' ? 'transfer-1' : true, error: failChunk && request.action === 'chunk' ? 'Storage full' : null }) })
        if (['finish', 'abort', 'url'].includes(request.action)) complete()
      })
    },
  }
  Object.assign(dom.window, { lumiverseDownloads: bridge, fetch, Blob: legacyBlob ? dom.window.Blob : Blob })
  Object.assign(dom.window.URL, {
    createObjectURL: (blob: Blob) => legacyBlob ? 'blob:https://lumiverse.example/legacy' : URL.createObjectURL(blob),
    revokeObjectURL: (url: string) => { if (!legacyBlob) URL.revokeObjectURL(url) },
  })
  dom.window.eval(script)
  function click(url: string, attached: boolean, filename = 'example.json') {
    const anchor = dom.window.document.createElement('a')
    anchor.href = url; anchor.download = filename
    if (attached) dom.window.document.body.append(anchor)
    anchor.click()
    anchor.remove()
  }
  return { dom, click, messages, chunks, done, reply: (index: number, result: unknown, error: string | null = null) => bridge.onmessage?.({ data: JSON.stringify({ id: messages[index]!.id, result, error }) }) }
}

test('blob exports survive immediate URL revocation, with exact binary chunks and acknowledgements', async () => {
  for (const attached of [true, false]) {
    const page = fixture()
    const bytes = Uint8Array.from({ length: 180000 }, (_, index) => index % 256)
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
    page.click(url, attached, 'character.png')
    URL.revokeObjectURL(url)
    await page.done
    expect(page.messages.map(message => message.action)).toEqual(['begin', 'chunk', 'chunk', 'chunk', 'chunk', 'finish'])
    expect(page.messages[0]!.payload).toEqual({ filename: 'character.png', mimeType: 'image/png', size: bytes.length })
    expect(Buffer.concat(page.chunks)).toEqual(Buffer.from(bytes))
    expect(page.messages.filter(message => message.action === 'chunk').map(message => message.payload.offset)).toEqual([0, 49152, 98304, 147456])
  }
})

test('a native write failure aborts the pending export and stops sending chunks', async () => {
  const page = fixture(true)
  const url = URL.createObjectURL(new Blob([new Uint8Array(100000)]))
  page.click(url, false)
  URL.revokeObjectURL(url)
  await page.done
  expect(page.messages.map(message => message.action)).toEqual(['begin', 'chunk', 'abort'])
  expect(page.messages.at(-1)!.payload.transfer).toBe('transfer-1')
  expect(page.messages.at(-1)!.payload.message).toContain('write the export')
  expect(page.messages.at(-1)!.payload.message).toContain('Storage full')
})

test('page-generated lorebook JSON needs no blob fetch and survives immediate URL revocation', async () => {
  for (const attached of [true, false]) {
    const page = fixture()
    const fetchBlob = () => { throw new Error('Blocked by connect-src') }
    page.dom.window.fetch = fetchBlob as any
    const contents = JSON.stringify({ name: 'Lorebook 世界', entries: Array.from({ length: 2000 }, (_, id) => ({ id, content: '🌌 lore '.repeat(100) })) }, null, 2)
    const blob = new Blob([contents], { type: 'application/json' })
    const url = page.dom.window.URL.createObjectURL(blob)
    page.click(url, attached, 'lorebook.json')
    page.dom.window.URL.revokeObjectURL(url)
    await page.done
    expect(page.messages.at(-1)!.action).toBe('finish')
    expect(page.messages[0]!.payload.size).toBe(new TextEncoder().encode(contents).byteLength)
    expect(Buffer.concat(page.chunks)).toEqual(Buffer.from(contents))
  }
})

test('read failures identify the failed stage instead of suggesting a storage problem', async () => {
  const page = fixture()
  page.dom.window.fetch = (async () => { throw new Error('Blocked by connect-src') }) as any
  page.click('blob:https://lumiverse.example/not-created-here', false)
  await page.done
  expect(page.messages.map(message => message.action)).toEqual(['abort'])
  expect(page.messages[0]!.payload.message).toContain('read the generated export')
})

test('older WebViews can read export chunks with FileReader instead of Blob.arrayBuffer', async () => {
  const page = fixture(false, true)
  Object.defineProperty(page.dom.window.Blob.prototype, 'arrayBuffer', { configurable: true, value: undefined })
  const content = 'Lorebook 🌌 世界\n'.repeat(10000)
  const blob = new page.dom.window.Blob([content], { type: 'application/json' })
  expect(typeof blob.arrayBuffer).toBe('undefined')
  const url = page.dom.window.URL.createObjectURL(blob)
  page.click(url, false, 'lorebook.json')
  page.dom.window.URL.revokeObjectURL(url)
  await page.done
  expect(page.messages.at(-1)!.action).toBe('finish')
  expect(Buffer.concat(page.chunks)).toEqual(Buffer.from(content))
})

test('prepared URL exports use the native streaming path without fetching a blob', async () => {
  const page = fixture()
  page.click('/api/v1/export?ticket=123', true, 'cards.charx')
  await page.done
  expect(page.messages).toHaveLength(1)
  expect(page.messages[0]!.payload).toEqual({ url: 'https://lumiverse.example/api/v1/export?ticket=123', filename: 'cards.charx' })
})

test('repeated initialization preserves the request dispatcher used by existing click listeners', async () => {
  const page = fixture()
  page.dom.window.eval(script)
  const url = URL.createObjectURL(new Blob(['lorebook']))
  page.click(url, true)
  URL.revokeObjectURL(url)
  await page.done
  expect(page.messages.map(message => message.action)).toEqual(['begin', 'chunk', 'finish'])
})

test('ordinary links and iframe pages do not install download behavior', () => {
  const page = fixture()
  const anchor = page.dom.window.document.createElement('a')
  anchor.href = '#section'
  page.dom.window.document.body.append(anchor)
  anchor.click()
  expect(page.messages).toHaveLength(0)
  const frame = page.dom.window.document.createElement('iframe')
  page.dom.window.document.body.append(frame)
  const child = frame.contentWindow!
  const original = child.HTMLAnchorElement.prototype.click
  child.eval(script)
  expect(child.HTMLAnchorElement.prototype.click).toBe(original)
})

test('awaited native Blob saves complete only after native publication acknowledges finish', async () => {
  const page = fixture(false, false, false)
  let complete = false
  const saved = (page.dom.window as any).lumiverseNativeDownloads.saveBlob(new Blob(['PNG bytes']), 'card.png').then(() => { complete = true })
  expect(page.messages.map(message => message.action)).toEqual(['begin'])
  expect(complete).toBe(false)
  page.reply(0, 'transfer-1')
  await Bun.sleep(0)
  expect(page.messages.at(-1)!.action).toBe('chunk')
  page.reply(1, true)
  await Bun.sleep(0)
  expect(page.messages.at(-1)!.action).toBe('finish')
  expect(complete).toBe(false)
  page.reply(2, true)
  await saved
  expect(complete).toBe(true)
})

test('awaited native saves reject a destination-open failure instead of reporting success', async () => {
  const page = fixture(false, false, false)
  const saved = (page.dom.window as any).lumiverseNativeDownloads.saveBlob(new Blob(['PNG bytes']), 'card.png').catch((error: Error) => error)
  page.reply(0, null, 'open failed: EACCES (Permission denied)')
  await Bun.sleep(0)
  expect(page.messages.map(message => message.action)).toEqual(['begin', 'abort'])
  page.reply(1, true)
  expect((await saved).message).toContain('Permission denied')
})

test('awaited CHARX URLs remain pending until native download completion', async () => {
  const page = fixture(false, false, false)
  let complete = false
  const saved = (page.dom.window as any).lumiverseNativeDownloads.saveUrl('/card.charx', 'card.charx').then(() => { complete = true })
  await Bun.sleep(0)
  expect(complete).toBe(false)
  expect(page.messages.map(message => message.action)).toEqual(['url'])
  page.reply(0, true)
  await saved
  expect(complete).toBe(true)
})
