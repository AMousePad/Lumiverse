#!/usr/bin/env bun
/** Disposable fixtures and uniquely named exports, only on an explicitly selected emulator. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { build } from '../frontend/node_modules/esbuild/lib/main.js'

const serial = process.argv[process.argv.indexOf('--serial') + 1]
if (!serial?.startsWith('emulator-')) throw new Error('Select a test emulator with --serial emulator-PORT')
const adb = join(process.env.ANDROID_HOME || join(process.env.HOME!, 'Library/Android/sdk'), 'platform-tools/adb')
const app = 'chat.lumiverse.prototype'
const prefix = `lumiverse-export-smoke-${Date.now()}`
const bytes = Uint8Array.from({ length: 180000 }, (_, index) => index % 256)
const fixture = await build({
  absWorkingDir: join(import.meta.dir, '..'), entryPoints: ['frontend/tests/ui-scale.fixture.tsx'],
  outfile: 'fixture.js', bundle: true, write: false, format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
})
const js = fixture.outputFiles.find(file => file.path.endsWith('.js'))!.text
const css = fixture.outputFiles.find(file => file.path.endsWith('.css'))!.text
let authenticated = 0
let foreignRequests = 0
const foreign = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => {
  foreignRequests++
  return new Response('<script>parent.postMessage({foreignDownloadBridge:typeof window.lumiverseDownloads},"*")</script>', { headers: { 'Content-Type': 'text/html' } })
} })
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => {
  const path = new URL(request.url).pathname
  if (path === '/fixture.js') return new Response(js, { headers: { 'Content-Type': 'text/javascript' } })
  if (path === '/fixture.css') return new Response(css, { headers: { 'Content-Type': 'text/css' } })
  if (path === '/frame') return new Response('<!doctype html><title>Frame</title>', { headers: { 'Content-Type': 'text/html' } })
  if (path === '/redirect-foreign') return Response.redirect(`http://127.0.0.1:${foreign.port}/leak`, 302)
  if (path === '/failure') return new Response('Unauthorized', { status: 401 })
  if (path === '/archive' || path === '/attachment') {
    if (!request.headers.get('Cookie')?.includes('export-smoke=1')) return new Response('Missing cookie', { status: 401 })
    authenticated++
    return new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${prefix}-attachment.charx"` } })
  }
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Android export smoke</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`,
    { headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'export-smoke=1; Path=/; SameSite=Lax', 'Cache-Control': 'no-store' } })
} })
const serverPort = server.port
const foreignPort = foreign.port
async function command(...args: string[]) {
  const child = Bun.spawn([adb, '-s', serial, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code) throw new Error(error || output)
  return output.trim()
}
async function evaluate<T = unknown>(expression: string): Promise<T> {
  const pid = (await command('shell', 'pidof', app)).split(' ')[0]
  const port = await command('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`)
  try {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as Array<{ webSocketDebuggerUrl: string; type: string }>
    const page = pages.find(page => page.type === 'page') || pages[0]
    assert.ok(page, 'WebView must be available')
    return await new Promise<T>((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl)
      const timer = setTimeout(() => { socket.close(); reject(new Error('WebView evaluation timed out')) }, 15000)
      socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
      socket.onmessage = event => {
        const reply = JSON.parse(String(event.data))
        if (reply.id !== 1) return
        clearTimeout(timer); socket.close()
        if (reply.error || reply.result?.exceptionDetails) reject(new Error(JSON.stringify(reply)))
        else resolve(reply.result.result.value)
      }
      socket.onerror = () => { clearTimeout(timer); socket.close(); reject(new Error('WebView debugging failed')) }
    })
  } finally { await command('forward', '--remove', `tcp:${port}`) }
}
async function waitFor(check: () => Promise<boolean>, label: string, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try { if (await check()) return } catch { /* Navigation can replace the execution context. */ }
    await Bun.sleep(300)
  }
  throw new Error(`Timed out: ${label}`)
}
async function chooser() {
  if (await evaluate("!!document.getElementById('connection-form')")) return
  for (let attempt = 0; attempt < 8; attempt++) {
    await command('shell', 'input', 'keyevent', '4')
    await command('shell', 'uiautomator', 'dump', '/sdcard/lumiverse-export-controls.xml')
    const xml = await command('shell', 'cat', '/sdcard/lumiverse-export-controls.xml')
    const bounds = xml.match(/text="Change server"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
    if (!bounds) continue
    await command('shell', 'input', 'tap', String((+bounds[1]! + +bounds[3]!) / 2), String((+bounds[2]! + +bounds[4]!) / 2))
    await waitFor(() => evaluate("!!document.getElementById('connection-form')"), 'connection chooser')
    return
  }
  throw new Error('Native Change server control did not open')
}
const files = async () => (await command('shell', 'ls', '/sdcard/Download/Lumiverse')).split('\n').filter(name => name.startsWith(prefix))
async function expectFile(name: string, expected = bytes) {
  await waitFor(async () => (await files()).includes(name), `saved ${name}`)
  const path = `/sdcard/Download/Lumiverse/${name}`
  const child = Bun.spawn([adb, '-s', serial, 'exec-out', 'cat', path], { stdout: 'pipe', stderr: 'pipe' })
  const result = new Uint8Array(await new Response(child.stdout).arrayBuffer())
  assert.equal(await child.exited, 0)
  assert.deepEqual(result, expected, `Saved bytes for ${name}`)
}
async function clickBlob(name: string, attached: boolean, mime = 'image/png') {
  await evaluate(`(() => {
    const bytes = Uint8Array.from({length:180000}, (_, index) => index % 256);
    const url = URL.createObjectURL(new Blob([bytes], {type:${JSON.stringify(mime)}}));
    const a = document.createElement('a'); a.href=url; a.download=${JSON.stringify(name)};
    if (${attached}) document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url); return true;
  })()`)
}
let saved: { mode: string | null; server: string | null } | undefined
try {
  await command('reverse', `tcp:${server.port}`, `tcp:${server.port}`)
  await command('reverse', `tcp:${foreign.port}`, `tcp:${foreign.port}`)
  await command('shell', 'am', 'force-stop', app)
  await command('shell', 'am', 'start', '-n', `${app}/.MainActivity`)
  await waitFor(() => evaluate('document.readyState === "complete"'), 'app launch')
  console.log('APK launched; opening the connection chooser')
  await chooser()
  saved = await evaluate("window.__TAURI_INTERNALS__.invoke('mobile_connection',{action:'info'})")
  await evaluate(`document.getElementById('server').value='http://127.0.0.1:${server.port}'; document.getElementById('connection-form').requestSubmit(); true`)
  await waitFor(() => evaluate("document.title === 'Android export smoke' && !!window.uiScaleFixture && !!window.lumiverseDownloads"), 'hosted export fixture')
  console.log('Hosted fixture and native export bridge ready')
  await evaluate(`(() => { window.exportReplies=[]; const original=lumiverseDownloads.onmessage; lumiverseDownloads.onmessage=e=>{window.exportReplies.push(JSON.parse(e.data)); if(original)original(e)}; return true })()`)

  await clickBlob(`${prefix}-card.png`, true)
  await expectFile(`${prefix}-card.png`)
  await clickBlob(`${prefix}-card.png`, false)
  await waitFor(async () => (await files()).filter(name => name.includes('-card')).length === 2, 'duplicate filename')
  await expectFile((await files()).find(name => name.includes('-card') && name !== `${prefix}-card.png`)!)
  await evaluate(`(() => { const a=document.createElement('a'); a.href='data:application/json,%7B%22test%22%3Atrue%7D'; a.download='${prefix}-lorebook.json'; a.click(); return true })()`)
  await expectFile(`${prefix}-lorebook.json`, new TextEncoder().encode('{"test":true}'))
  await evaluate(`(() => { const a=document.createElement('a'); a.href='/archive'; a.download='${prefix}-archive.charx'; a.click(); return true })()`)
  await expectFile(`${prefix}-archive.charx`)
  await evaluate("location.href='/attachment'; true")
  await expectFile(`${prefix}-attachment.charx`)
  // The listener route is first requested by WebView, then streamed by native code.
  assert.equal(authenticated, 3, 'Both native URL routes must preserve session cookies')
  console.log('Blob PNG, JSON, duplicates, authenticated URL exports and DownloadListener: passed')

  // Observe native replies without replacing the wrapper's request dispatcher.
  await evaluate(`(() => {
    window.smokeReplies={}; const original=lumiverseDownloads.onmessage;
    lumiverseDownloads.onmessage=e=>{ original(e); const r=JSON.parse(e.data); window.smokeReplies[r.id]=r; };
    lumiverseDownloads.postMessage(JSON.stringify({id:'bad-begin',action:'begin',payload:{filename:'${prefix}-incomplete.json',mimeType:'application/json',size:10}})); return true;
  })()`)
  await waitFor(() => evaluate("!!window.smokeReplies['bad-begin']"), 'native begin')
  await evaluate(`lumiverseDownloads.postMessage(JSON.stringify({id:'bad-finish',action:'finish',payload:{transfer:window.smokeReplies['bad-begin'].result}})); true`)
  await waitFor(() => evaluate("!!window.smokeReplies['bad-finish']?.error"), 'incomplete export rejection')
  assert.ok(!(await files()).some(name => name.includes('incomplete')), 'Incomplete exports must be removed')
  await evaluate(`(() => { for(const path of ['/failure','/redirect-foreign']) { const a=document.createElement('a'); a.href=path; a.download='${prefix}-failed.charx'; a.click(); } return true })()`)
  await Bun.sleep(1500)
  assert.equal(foreignRequests, 0, 'Redirect must not send cookies to another origin')
  assert.ok(!(await files()).some(name => name.includes('failed')), 'HTTP failures must not become saved exports')
  await evaluate(`(() => { window.addEventListener('message', e=>{if(e.data?.foreignDownloadBridge)window.foreignDownloadBridge=e.data.foreignDownloadBridge}); const frame=document.createElement('iframe'); frame.src='http://127.0.0.1:${foreign.port}/'; frame.id='foreign'; document.body.append(frame); return true })()`)
  await waitFor(() => evaluate("window.foreignDownloadBridge === 'undefined'"), 'foreign frame has no bridge')
  await evaluate(`(() => { const frame=document.createElement('iframe'); frame.src='/frame'; frame.onload=()=>{window.frameDownloadTestReady=true; frame.contentWindow.lumiverseDownloads.onmessage=()=>{window.frameDownloadReply=true}; frame.contentWindow.lumiverseDownloads.postMessage(JSON.stringify({id:'frame-begin',action:'begin',payload:{filename:'${prefix}-frame.json',mimeType:'application/json',size:0}}))}; document.body.append(frame); return true })()`)
  await waitFor(() => evaluate('window.frameDownloadTestReady === true'), 'same-origin frame request')
  await Bun.sleep(500)
  assert.equal(await evaluate('!!window.frameDownloadReply'), false, 'Native bridge must ignore subframe requests')
  assert.ok(!(await files()).some(name => name.includes('-frame')), 'Subframes must not create exports')
  console.log('Incomplete export cleanup, HTTP failure, redirect and iframe isolation: passed')

  const scales = [0.5, 0.8, 1, 1.25, 1.5]
  const geometry = []
  for (const scale of scales) {
    await evaluate(`window.uiScaleFixture.setScale(${scale}); window.uiScaleFixture.setModal(true); true`)
    await Bun.sleep(350)
    const result = await evaluate<{ width: number; height: number; left: number; top: number; right: number; bottom: number; viewportWidth: number; viewportHeight: number }>(`(() => { const r=document.getElementById('modal-content').parentElement.getBoundingClientRect(); return {...r.toJSON(),viewportWidth:innerWidth,viewportHeight:innerHeight} })()`)
    assert.ok(Math.abs(result.width - Math.min(560, result.viewportWidth - 24)) < 1, `Contained modal width at ${scale}: ${JSON.stringify(result)}`)
    assert.ok(result.height <= result.viewportHeight * 0.9 + 1 && result.height > 0, `Contained modal height cap at ${scale}: ${JSON.stringify(result)}`)
    assert.ok(result.left >= 11 && result.right <= result.viewportWidth - 11 && result.top >= 11 && result.bottom <= result.viewportHeight - 11, `Visible modal margins at ${scale}: ${JSON.stringify(result)}`)
    await evaluate('window.uiScaleFixture.setCompact(true); true')
    await Bun.sleep(100)
    const compactHeight = await evaluate<number>("document.getElementById('modal-content').parentElement.getBoundingClientRect().height")
    assert.ok(compactHeight < result.viewportHeight / 2, `Short prompt keeps its natural height at ${scale}`)
    await evaluate('window.uiScaleFixture.setCompact(false); true')
    geometry.push({ scale, ...result })
  }
  await Bun.write(join(import.meta.dir, '../dist/android/smoke-test-exports.json'), JSON.stringify({ testedAt: new Date().toISOString(), serial, files: await files(), authenticatedDownloads: authenticated, scales: geometry, passed: true }, null, 2) + '\n')
  console.log('Native WebView contained modal sizing at 50%, 80%, 100%, 125%, 150%: passed')
} catch (error) {
  console.log('Native replies:', await evaluate('window.exportReplies').catch(() => null))
  console.log('Export directory:', await files().catch(() => []))
  throw error
} finally {
  try {
    if (saved) {
      await chooser()
      if (saved.mode === 'remote' && saved.server) await evaluate(`document.getElementById('server').value=${JSON.stringify(saved.server)}; document.getElementById('connection-form').requestSubmit(); true`)
      else if (saved.mode === 'local') await evaluate("document.getElementById('local').click(); true")
    }
  } catch { /* Preserve failure evidence if the app stopped. */ }
  server.stop(true); foreign.stop(true)
  await command('reverse', '--remove', `tcp:${serverPort}`).catch(() => {})
  await command('reverse', '--remove', `tcp:${foreignPort}`).catch(() => {})
}
