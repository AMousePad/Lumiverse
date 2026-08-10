import { describe, expect, test } from 'bun:test'

function selectorBlock(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'm'))
  expect(match, `expected ${selector} CSS rule to exist`).not.toBeNull()
  return match![1]
}

function atRuleBlock(css: string, prelude: string): string {
  const start = css.indexOf(prelude)
  expect(start, `expected ${prelude} CSS at-rule to exist`).toBeGreaterThanOrEqual(0)

  const openingBrace = css.indexOf('{', start)
  let depth = 0
  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') depth -= 1
    if (depth === 0) return css.slice(openingBrace + 1, index)
  }

  throw new Error(`expected ${prelude} CSS at-rule to close`)
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

  test('keeps mobile cards in two constrained fluid columns', async () => {
    const css = await Bun.file(new URL('./HomepageCharacterLibrary.module.css', import.meta.url)).text()
    const mobile = atRuleBlock(css, '@media (max-width: 760px)')
    const mobileLibrary = selectorBlock(mobile, '.library')
    const mobileGrid = selectorBlock(mobile, '.grid')
    const gridState = selectorBlock(css, '.grid > .state')

    expect(mobileLibrary).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(mobileLibrary).toMatch(/min-width:\s*0/)
    expect(mobileGrid).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
    expect(gridState).toMatch(/grid-column:\s*1\s*\/\s*-1/)
    expect(gridState).toMatch(/min-width:\s*0/)
  })

  test('opens the mobile preview as a bounded viewport overlay', async () => {
    const css = await Bun.file(new URL('./HomepageCharacterLibrary.module.css', import.meta.url)).text()
    const mobile = atRuleBlock(css, '@media (max-width: 760px)')
    const mobileBody = selectorBlock(mobile, '.body')
    const mobileOpenBody = selectorBlock(mobile, ".body[data-panel-open='true']")
    const mobilePreview = selectorBlock(mobile, '.preview[data-pinned]')
    const mobileBackdrop = selectorBlock(mobile, '.previewBackdrop')
    const mobileGlow = selectorBlock(mobile, '.previewBackdropGlow')
    const mobileViewportLayer = selectorBlock(mobile, '.previewBackdropViewportLayer')
    const mobileGridLayer = selectorBlock(mobile, '.preview[data-pinned]::after')
    const mobileControls = selectorBlock(mobile, '.previewControls')

    expect(mobileBody).toMatch(/min-width:\s*0/)
    expect(mobileBody).toMatch(/width:\s*100%/)
    expect(mobileBody).toMatch(/overflow:\s*hidden/)
    expect(mobileOpenBody).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(mobilePreview).toMatch(/position:\s*fixed/)
    expect(mobilePreview).toMatch(
      /inset:\s*calc\(64px\s*\+\s*env\(safe-area-inset-top\)\)\s+12px\s+calc\(12px\s*\+\s*env\(safe-area-inset-bottom\)\)/,
    )
    expect(mobilePreview).toMatch(/width:\s*auto/)
    expect(mobilePreview).toMatch(/background-color:\s*var\(--lumiverse-bg-deep,\s*#0a0812\)/)
    expect(mobilePreview).not.toMatch(/--homepage-preview-page-/)
    expect(mobilePreview).not.toMatch(/60px\s+60px/)
    expect(mobilePreview).not.toMatch(/--lumiverse-primary-010/)
    expect(mobileGridLayer).toMatch(/background-image:\s*var\(--homepage-preview-grid-image,\s*none\)/)
    expect(mobileGridLayer).toMatch(/background-size:\s*var\(--homepage-preview-grid-size,\s*auto\)/)
    expect(mobileGridLayer).toMatch(/opacity:\s*var\(--homepage-preview-grid-opacity,\s*0\)/)
    expect(mobileGridLayer).not.toMatch(/60px\s+60px/)
    expect(mobileGridLayer).not.toMatch(/--lumiverse-primary-010/)
    expect(mobileBackdrop).toMatch(/position:\s*absolute/)
    expect(mobileBackdrop).toMatch(/overflow:\s*hidden/)
    expect(mobileGlow).toMatch(/position:\s*absolute/)
    expect(mobileViewportLayer).toMatch(/position:\s*absolute/)
    expect(mobileViewportLayer).toMatch(/pointer-events:\s*none/)
    expect(mobilePreview).toMatch(/isolation:\s*isolate/)
    expect(mobilePreview).toMatch(/overflow:\s*hidden/)
    expect(mobileControls).toMatch(/position:\s*relative/)
    expect(mobileControls).toMatch(/z-index:\s*10/)
  })

  test('gives preview controls explicit accessible names and keyboard focus styling', async () => {
    const [css, tsx, landingTsx] = await Promise.all([
      Bun.file(new URL('./HomepageCharacterLibrary.module.css', import.meta.url)).text(),
      Bun.file(new URL('./HomepageCharacterLibrary.tsx', import.meta.url)).text(),
      Bun.file(new URL('./LandingPage.tsx', import.meta.url)).text(),
    ])
    const focusStyle = selectorBlock(css, '.previewControls button:focus-visible')

    expect(tsx).toMatch(/aria-label=\{settings\.panelPinned \? 'Unpin preview' : 'Pin preview'\}/)
    expect(tsx).toMatch(/aria-label="Close preview"/)
    expect(tsx).toMatch(/role=\{isMobileViewport \? 'dialog' : undefined\}/)
    expect(tsx).toMatch(/aria-modal=\{isMobileViewport \|\| undefined\}/)
    expect(tsx).toMatch(/window\.getComputedStyle\(document\.documentElement\)/)
    expect(tsx).toMatch(/window\.getComputedStyle\(document\.body, '::before'\)/)
    expect(tsx).toMatch(/window\.getComputedStyle\(document\.body, '::after'\)/)
    expect(tsx).toMatch(/document\.querySelector<HTMLElement>\('\[data-landing-background-grid\]'\)/)
    expect(tsx).toMatch(/className=\{styles\.previewBackdropViewportLayer\}/)
    expect(tsx).toMatch(/mixBlendMode:\s*layer\.mixBlendMode/)
    expect(tsx).toMatch(/--homepage-preview-grid-image': pageBackground\.gridImage/)
    expect(tsx).toMatch(/data-landing-background-glow/)
    expect(tsx).toMatch(/className=\{styles\.previewBackdrop\}/)
    expect(landingTsx).toMatch(/data-landing-background-glow/)
    expect(landingTsx).toMatch(/data-landing-background-grid/)
    expect(tsx).not.toMatch(/homepage-preview-(?:stars|nebula)/)
    expect(tsx).toMatch(/aria-labelledby=\{isMobileViewport \? 'homepage-character-preview-title' : undefined\}/)
    expect(tsx).toMatch(/isMobileViewport && event\.key === 'Escape'/)
    expect(tsx).toMatch(/closePreviewButtonRef\.current\?\.focus\(\)/)
    expect(focusStyle).toMatch(/outline:\s*2px\s+solid\s+var\(--lumiverse-primary\)/)
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
