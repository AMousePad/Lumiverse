import { describe, expect, test } from 'bun:test'

function selectorBlock(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'))
  expect(match, `expected ${selector} CSS rule to exist`).not.toBeNull()
  return match![1]
}

function closingDivAfterOpeningDiv(source: string, className: string): number {
  const openingDiv = new RegExp(`<div\\b[^>]*className=\\{styles\\.${className}\\}[^>]*>`, 'm').exec(source)
  expect(openingDiv, `expected ${className} wrapper to exist`).not.toBeNull()

  const divToken = /<div\b[^>]*>|<\/div>/g
  divToken.lastIndex = openingDiv!.index
  let depth = 0
  for (let token = divToken.exec(source); token; token = divToken.exec(source)) {
    depth += token[0] === '</div>' ? -1 : 1
    if (depth === 0) return token.index
  }

  throw new Error(`expected ${className} wrapper to close`)
}

describe('HomepageCharacterLibrary preview overflow contract', () => {
  test('keeps preview content width-contained and vertically scrollable', async () => {
    const css = await Bun.file(new URL('./HomepageCharacterLibrary.module.css', import.meta.url)).text()
    const previewBody = selectorBlock(css, '.previewBody')

    expect(previewBody).toMatch(/min-width:\s*0/)
    expect(previewBody).toMatch(/max-width:\s*100%/)
    expect(previewBody).toMatch(/min-height:\s*0/)
    expect(previewBody).toMatch(/overflow-y:\s*auto/)
    expect(previewBody).toMatch(/overflow-x:\s*hidden/)
    expect(previewBody).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/)
  })

  test('prevents the image intrinsic width from expanding the preview body grid', async () => {
    const css = await Bun.file(new URL('./HomepageCharacterLibrary.module.css', import.meta.url)).text()
    const imageFrame = selectorBlock(css, '.previewImageFrame')

    expect(imageFrame).toMatch(/width:\s*100%/)
    expect(imageFrame).toMatch(/min-width:\s*0/)
    expect(imageFrame).toMatch(/max-width:\s*100%/)
  })

  test('keeps the outer preview clipped and reserves space for its bottom action', async () => {
    const css = await Bun.file(new URL('./HomepageCharacterLibrary.module.css', import.meta.url)).text()
    const preview = selectorBlock(css, '.preview')

    expect(preview).toMatch(/overflow:\s*hidden/)
    expect(preview).toMatch(/padding(?:-bottom)?:[^;]*(?:62px|var\(--homepage-preview-action-clearance)/)
  })

  test('uses UI-scale-compensated viewport width for pinned preview clearance', async () => {
    const css = await Bun.file(new URL('./HomepageCharacterLibrary.module.css', import.meta.url)).text()
    const pinnedPreview = selectorBlock(css, ".preview[data-pinned='true']")

    expect(pinnedPreview).toMatch(
      /width:\s*min\([^;]*calc\(\(100vw\s*\/\s*var\(--lumiverse-ui-scale,\s*1\)\)\s*-\s*48px\)\)/,
    )
  })

  test('uses a shrinkable content column for the preview grid', async () => {
    const css = await Bun.file(new URL('./HomepageCharacterLibrary.module.css', import.meta.url)).text()
    const preview = selectorBlock(css, '.preview')

    expect(preview).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/)
  })

  test('keeps the image height control within its preview width', async () => {
    const css = await Bun.file(new URL('./HomepageCharacterLibrary.module.css', import.meta.url)).text()
    const imageHeightControl = selectorBlock(css, '.imageHeightControl')

    expect(imageHeightControl).toMatch(/min-width:\s*0/)
    expect(imageHeightControl).toMatch(/max-width:\s*100%/)
  })

  test('allows the image height input to shrink within its available width', async () => {
    const css = await Bun.file(new URL('./HomepageCharacterLibrary.module.css', import.meta.url)).text()
    const imageHeightInput = selectorBlock(css, '.imageHeightControl input')

    expect(imageHeightInput).toMatch(/min-width:\s*0/)
    expect(imageHeightInput).toMatch(/width:\s*100%/)
    expect(imageHeightInput).toMatch(/max-width:\s*100%/)
  })

  test('ellipsizes long preview names and creator text', async () => {
    const css = await Bun.file(new URL('./HomepageCharacterLibrary.module.css', import.meta.url)).text()
    const headerText = css.match(/\.previewHeader h3,\s*\.previewHeader p\s*\{([\s\S]*?)\n\}/m)?.[1]

    expect(headerText, 'expected shared preview title and creator rule to exist').toBeDefined()
    expect(headerText).toMatch(/overflow:\s*hidden/)
    expect(headerText).toMatch(/text-overflow:\s*ellipsis/)
    expect(headerText).toMatch(/white-space:\s*nowrap/)
  })

  test('keeps the chat action separately positioned outside the scroll body', async () => {
    const [css, tsx] = await Promise.all([
      Bun.file(new URL('./HomepageCharacterLibrary.module.css', import.meta.url)).text(),
      Bun.file(new URL('./HomepageCharacterLibrary.tsx', import.meta.url)).text(),
    ])
    const openChatButton = selectorBlock(css, '.openChatBtn')

    expect(openChatButton).toMatch(/position:\s*absolute/)
    expect(openChatButton).toMatch(/inset:\s*auto\s+12px\s+12px/)
    expect(tsx).toMatch(/className=\{styles\.previewBody\}/)
    expect(tsx).toMatch(/className=\{styles\.openChatBtn\}/)
    expect(tsx.indexOf('className={styles.openChatBtn}')).toBeGreaterThan(
      closingDivAfterOpeningDiv(tsx, 'previewBody'),
    )
  })
})
