/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { processMarkdownInHtmlIsland } from './htmlIslandMarkdown'

function render(html: string): string {
  return processMarkdownInHtmlIsland(html, {
    renderBlockText: (markdown) => `<block>${markdown.trim()}</block>`,
    renderInlineText: (markdown) => `<inline>${markdown.trim()}</inline>`,
  })
}

describe('processMarkdownInHtmlIsland', () => {
  test('keeps markdown inside span-based code editor rows inline', () => {
    const html = [
      '<div style="background:#1e1e2e;">',
      '  <span style="color:#6c7086;"># flatten nested response</span><br>',
      '</div>',
    ].join('')

    expect(render(html)).toContain('<span style="color:#6c7086;"><inline># flatten nested response</inline></span><br>')
    expect(render(html)).not.toContain('<block># flatten nested response</block>')
  })

  test('still allows block markdown in block containers', () => {
    expect(render('<div># heading</div>')).toBe('<div><block># heading</block></div>')
  })

  test('treats paragraph text as inline markdown to avoid invalid nested blocks', () => {
    expect(render('<p># heading</p>')).toBe('<p><inline># heading</inline></p>')
  })

  test('does not parse text inside pre/code/script blocks', () => {
    expect(render('<pre># heading</pre>')).toBe('<pre># heading</pre>')
    expect(render('<code>**bold**</code>')).toBe('<code>**bold**</code>')
    expect(render('<script># heading</script>')).toBe('<script># heading</script>')
  })

  test('does not parse text inside svg subtrees', () => {
    expect(render('<svg><text>*bold*</text></svg>')).toBe('<svg><text>*bold*</text></svg>')
  })

  test('unknown pseudo-tags do not flip following prose to inline', () => {
    const html = '<div><close>\n\n## NPC\n\n*intro*</div>'
    expect(render(html)).toContain('<block>## NPC\n\n*intro*</block>')
  })

  test('unreplaced card markers with payloads do not become markdown context', () => {
    const html = '<div><Name: evan | Background: heropng>\n\n## HEROES</div>'
    expect(render(html)).toContain('<block>## HEROES</block>')
  })

  test('stray unknown close tags do not pop known containers', () => {
    const html = '<div></wiki># heading</div>'
    expect(render(html)).toBe('<div></wiki><block># heading</block></div>')
  })

  test('form is sanitizer-forbidden and does not become markdown context', () => {
    expect(render('<div><form>## heading</div>')).toContain('<block>## heading</block>')
  })

  const WRAP = '<div data-message-prose class="not-island-prose">'

  test('inline-led paragraph after a block element wraps in <p>', () => {
    const html = `${WRAP}<table><tbody><tr><td>x</td></tr></tbody></table>\n\n<span>"Oho!"</span> she boomed.\n\nNext.</div>`
    const outHtml = render(html)
    expect(outHtml).toContain('<p><span><inline>"Oho!"</inline></span><inline>she boomed.</inline></p>')
    expect(outHtml).toContain('<block>Next.</block>')
  })

  test('text-led paragraph joins its trailing inline tags in one <p>', () => {
    const outHtml = render(`${WRAP}\n\nHe said <span>"hi"</span> and left.\n\n</div>`)
    expect(outHtml).toContain('<p><inline>He said</inline><span><inline>"hi"</inline></span><inline>and left.</inline></p>')
  })

  test('standalone inline-only dialogue line wraps in <p>', () => {
    const outHtml = render(`${WRAP}intro\n\n<span>"Quote"</span>\n\noutro</div>`)
    expect(outHtml).toContain('<p><span><inline>"Quote"</inline></span></p>')
    expect(outHtml).toContain('<block>intro</block>')
    expect(outHtml).toContain('<block>outro</block>')
  })

  test('tag-only groups such as a lone image stay unwrapped', () => {
    const outHtml = render(`${WRAP}a\n\n<img src="x">\n\nb</div>`)
    expect(outHtml).toContain('<img src="x">')
    expect(outHtml).not.toContain('<p><img')
  })

  test('blank line inside trailing text closes the paragraph', () => {
    const outHtml = render(`${WRAP}<span>q</span> tail\n\n# heading</div>`)
    expect(outHtml).toContain('<p><span><inline>q</inline></span><inline>tail</inline></p>')
    expect(outHtml).toContain('<block># heading</block>')
  })

  test('raw HTML runs to the first blank line, CommonMark-style', () => {
    const tight = render(`${WRAP}<div class="row">Name:\n<span>Haru</span></div></div>`)
    expect(tight).not.toContain('<p>')
    expect(tight).toContain('Name:\n<span>Haru</span>')
    const blanked = render(`${WRAP}<div class="row">Name:\n\n<span>Haru</span></div></div>`)
    expect(blanked).toContain('<p><span><inline>Haru</inline></span></p>')
  })

  test('plain islands without the prose root never group', () => {
    const plainIsland = render('<div style="x">label\n\n<span>pill</span></div>')
    expect(plainIsland).not.toContain('<p>')
  })

  test('unbalanced card HTML still yields paragraphs after a blank line', () => {
    const html = `${WRAP}<div class="card"><h1>HP<br /><span>100</span></h15></div>\n\nThe dive begins.\n\n<span>"Ready?"</span> she asked.\n\n</div>`
    const outHtml = render(html)
    expect(outHtml).toContain('<block>The dive begins.</block>')
    expect(outHtml).toContain('<p><span><inline>"Ready?"</inline></span><inline>she asked.</inline></p>')
  })

  test('restores many styles without repeatedly scanning the whole output', () => {
    const html = '<div>' + Array.from({ length: 64 }, (_, i) => `<style>.item${i}{color:red}</style>`).join('') + '</div>'
    const originalReplace = String.prototype.replace
    let scannedCharacters = 0
    let result: string
    String.prototype.replace = function (this: string, ...args: Parameters<typeof originalReplace>) {
      scannedCharacters += this.length
      return originalReplace.apply(this, args)
    } as typeof originalReplace
    try {
      result = processMarkdownInHtmlIsland(html, {
        renderBlockText: (text) => text,
        renderInlineText: (text) => text,
      })
    } finally {
      String.prototype.replace = originalReplace
    }

    expect(result!).toBe(html)
    expect(scannedCharacters).toBeLessThanOrEqual(html.length * 2)
  })

  test('keeps replacement directives literal inside CSS', () => {
    const html = '<style>.label::after{content:"' + ['$&', '$`', "$'", '$$'].join('|') + '"}</style>'
    expect(render(html)).toBe(html)
  })

  test('does not reinterpret placeholder text inside restored CSS', () => {
    const html = '<style>.label::after{content:"<!--ISLAND_STYLE_1-->"}</style><style>.next{color:red}</style>'
    expect(render(html)).toBe(html)
  })

  test('consumes each style only once when raw input repeats a placeholder', () => {
    const marker = '<!--ISLAND_STYLE_0-->'
    expect(render(marker + marker + '<style>x</style>')).toBe('<style>x</style>' + marker + marker)
  })

  test.each([
    ['<STYLE media="screen">**literal**</STYLE >', '<STYLE media="screen">**literal**</STYLE >'],
    ['<style>**open**<style>still open', '<style><inline>**open**</inline><style><inline>still open</inline>'],
    ['<style></style><style><style>x</style>*later*</style>', '<style></style><style><style>x</style><block>*later*</block></style>'],
    ['<div title="<style>x</style>">tail</div>', '<div title="<style>x</style><block>">tail</block></div>'],
    ['<!--x<style>**x**</style>tail-->', '<!--x<style>**x**</style><block>tail--></block>'],
  ])('preserves existing style boundaries in %s', (html, expected) => {
    expect(render(html)).toBe(expected)
  })

  test('normalizes once after all styles have been restored', () => {
    const html = '<style>.first{color:red}</style><style>.second{color:blue}</style>'
    const normalized: string[] = []
    expect(processMarkdownInHtmlIsland(html, {
      renderBlockText: (text) => text,
      renderInlineText: (text) => text,
      normalizeHtml: (text) => {
        normalized.push(text)
        return '<normalized>' + text + '</normalized>'
      },
    })).toBe('<normalized>' + html + '</normalized>')
    expect(normalized).toEqual([html])
  })

  test('keeps callback-generated placeholder text literal', () => {
    expect(processMarkdownInHtmlIsland('text<style>.label{color:red}</style>', {
      renderBlockText: () => '<!--ISLAND_STYLE_0-->',
      renderInlineText: () => '<!--ISLAND_STYLE_0-->',
    })).toBe('<!--ISLAND_STYLE_0--><style>.label{color:red}</style>')
  })
})
