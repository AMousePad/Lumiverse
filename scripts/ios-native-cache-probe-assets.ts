import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

/** Build-time experiment: all executable shell bytes travel in one supplied
 * response. No runtime fetch interception or origin changes are involved. */
export function inlineProbeShell(directory: string): string {
  const root = resolve(directory)
  function asset(path: string): Buffer {
    if (!/^\/assets\/[a-zA-Z0-9_./-]+$/.test(path)) throw new Error(`Unsupported probe asset: ${path}`)
    const file = resolve(root, path.slice(1))
    if (!file.startsWith(root + sep)) throw new Error(`Probe asset escapes its build: ${path}`)
    return readFileSync(file)
  }
  let html = readFileSync(resolve(root, 'index.html'), 'utf8')
  html = html.replace(/<script\b[^>]*\bsrc="(\/assets\/[^"<>]+\.js)"[^>]*><\/script>/g, (_tag, path: string) => {
    let source = asset(path).toString('utf8')
    // With code splitting off, the remaining JS URLs refer to self-contained
    // Vite worker/worklet outputs. Blob URLs inherit the document's origin.
    source = source.replace(/(["'])(\/assets\/[^"'<>]+\.js)\1/g, (_literal, _quote: string, worker: string) => {
      const contents = asset(worker)
      if (new Bun.Transpiler({ loader: 'js' }).scanImports(contents.toString('utf8')).length > 0) throw new Error('The probe requires self-contained workers and worklets.')
      const bytes = contents.toString('base64')
      return `URL.createObjectURL(new Blob([Uint8Array.from(atob('${bytes}'), c => c.charCodeAt(0))], {type:'text/javascript'}))`
    })
    if (new Bun.Transpiler({ loader: 'js' }).scanImports(source).length > 0) throw new Error('The probe requires a self-contained application chunk.')
    return `<script type="module">${source.replace(/<\/script/gi, '<\\/script')}</script>`
  })
  html = html.replace(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="(\/assets\/[^"<>]+\.css)"[^>]*>/g, (_tag, path: string) => {
    const css = asset(path).toString('utf8').replace(/url\(\s*["']?(\/assets\/[^)'"\s]+)["']?\s*\)/g, (_url, resource: string) => {
      const mime = resource.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream'
      return `url(data:${mime};base64,${asset(resource).toString('base64')})`
    })
    return `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`
  })
  // Native owns the document. Neither a browser manifest nor module preloads
  // describe this transport; their original URLs would still hit the server.
  html = html.replace(/<link\b[^>]*\brel="(?:manifest|modulepreload)"[^>]*>/g, '')
  html = html.replace('<head>', '<head><meta name="lumiverse-native-cache" content="1">')
  if (/<script\b[^>]*\bsrc=|<link\b[^>]*\brel="stylesheet"/.test(html)) throw new Error('Unresolved executable probe resources.')
  return html
}
