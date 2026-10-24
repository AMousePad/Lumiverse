// Exercises the injected download script with a real CSP and real object URLs.
// Optional: --baseline REV demonstrates the failure using an older Git revision.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../../', import.meta.url))
const baselineIndex = process.argv.indexOf('--baseline')
const baseline = baselineIndex !== -1
const baselineRef = baseline ? process.argv[baselineIndex + 1] : undefined
if (baseline && !baselineRef) throw new Error('Pass an older Git revision after --baseline')
const path = 'android/tauri/src-tauri/src/downloads.js'
const script = baseline ? execFileSync('git', ['show', `${baselineRef}:${path}`], { cwd: root, encoding: 'utf8' }) : await readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const browser = await chromium.launch({ headless: true })
try {
  for (const attached of [false, true]) {
    const page = await browser.newPage()
    await page.route('http://lumiverse.test/', route => route.fulfill({
      contentType: 'text/html',
      headers: { 'Content-Security-Policy': "connect-src 'none'" },
      body: '<!doctype html><title>JSON export</title>',
    }))
    await page.addInitScript({ content: `
      window.exportChunks=[];
      window.lumiverseDownloads={postMessage(raw){
        const r=JSON.parse(raw);
        if(r.action==='chunk')window.exportChunks.push(r.payload.data);
        queueMicrotask(()=>{
          window.lumiverseDownloads.onmessage({data:JSON.stringify({id:r.id,result:r.action==='begin'?'transfer':true})});
          if(r.action==='finish'||r.action==='abort')window.exportResult=r;
        });
      }};
      ${script}` })
    await page.goto('http://lumiverse.test/')
    const content = await page.evaluate(attached => {
      const content = JSON.stringify({ name: 'Lorebook 世界', entries: Array.from({ length: 2000 }, (_, id) => ({ id, content: '🌌 lore '.repeat(100) })) }, null, 2)
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url; a.download = 'lorebook.json'
      if (attached) document.body.append(a)
      a.click(); a.remove(); URL.revokeObjectURL(url)
      return content
    }, attached)
    await page.waitForFunction(() => !!window.exportResult)
    const result = await page.evaluate(() => ({ action: window.exportResult.action, chunks: window.exportChunks }))
    assert.equal(result.action, baseline ? 'abort' : 'finish')
    if (!baseline) assert.deepEqual(Buffer.concat(result.chunks.map(chunk => Buffer.from(chunk, 'base64'))), Buffer.from(content))
    console.log(`${baseline ? 'Baseline reproduced failure' : 'JSON bytes verified'}: ${attached ? 'attached' : 'detached'} anchor, blob fetch blocked by CSP, URL immediately revoked`)
    await page.close()
  }
} finally {
  await browser.close()
}
