import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { resolve } from 'node:path'

let fitPortraitSize: typeof import('./PortraitDock').fitPortraitSize
let getPortraitLayoutReclaim: typeof import('./PortraitDock').getPortraitLayoutReclaim
let ownsPortraitPreviewForContext: typeof import('./PortraitDock').ownsPortraitPreviewForContext
let portraitDockOwnsFloatingAvatar: typeof import('./PortraitDock').portraitDockOwnsFloatingAvatar
let placeDockedPortraitRect: typeof import('./PortraitDock').placeDockedPortraitRect
let resolveDockSideForRect: typeof import('./PortraitDock').resolveDockSideForRect
let shouldAutoOpenPortraitForChat: typeof import('./PortraitDock').shouldAutoOpenPortraitForChat
let resolveDockedPortraitImageRect: typeof import('./PortraitDock').resolveDockedPortraitImageRect

mock.module('@/store', () => ({ useStore: () => ({}) }))
mock.module('@/components/shared/ContextMenu', () => ({ default: () => null }))

beforeAll(async () => {
  ;({ fitPortraitSize, getPortraitLayoutReclaim, ownsPortraitPreviewForContext, portraitDockOwnsFloatingAvatar, placeDockedPortraitRect, resolveDockSideForRect, resolveDockedPortraitImageRect, shouldAutoOpenPortraitForChat } = await import('./PortraitDock'))
})

describe('portrait dock placement', () => {
  test('uses the default lane position when no y coordinate is supplied', () => {
    const rect = placeDockedPortraitRect(
      { width: 280, height: 280 },
      'right',
      { minWidth: 180, minHeight: 180, maxWidth: 720, maxHeight: 860 },
      { width: 960, height: 615 },
    )

    expect(rect).toEqual({ x: 668, y: 323, width: 280, height: 280 })
  })

  test('preserves a valid y coordinate of zero when docking', () => {
    expect(placeDockedPortraitRect(
      { width: 280, height: 280 },
      'left',
      { minWidth: 180, minHeight: 180, maxWidth: 720, maxHeight: 860 },
      { width: 960, height: 615 },
      0,
    )).toEqual({ x: 12, y: 0, width: 280, height: 280 })
  })

  test('keeps a clamped vertical lane position while anchoring each side correctly', () => {
    const bounds = { minWidth: 180, minHeight: 180, maxWidth: 720, maxHeight: 860 }
    const viewport = { width: 960, height: 615 }

    expect(placeDockedPortraitRect({ width: 280, height: 280 }, 'left', bounds, viewport, 180))
      .toEqual({ x: 12, y: 180, width: 280, height: 280 })
    expect(placeDockedPortraitRect({ width: 280, height: 280 }, 'right', bounds, viewport, 580))
      .toEqual({ x: 668, y: 335, width: 280, height: 280 })
  })

  test('keeps the vertical lane position when switching dock sides', () => {
    const bounds = { minWidth: 180, minHeight: 180, maxWidth: 720, maxHeight: 860 }
    const viewport = { width: 960, height: 615 }
    const current = placeDockedPortraitRect({ width: 280, height: 280 }, 'left', bounds, viewport, 0)

    expect(placeDockedPortraitRect(current, 'right', bounds, viewport, current.y))
      .toEqual({ x: 668, y: 0, width: 280, height: 280 })
  })

  test('transfers the dock side when a dragged portrait crosses the chat midpoint', () => {
    const viewport = { width: 960, height: 615 }

    expect(resolveDockSideForRect({ x: 12, width: 280 }, viewport)).toBe('left')
    expect(resolveDockSideForRect({ x: 668, width: 280 }, viewport)).toBe('right')
    expect(placeDockedPortraitRect(
      { width: 280, height: 280 },
      resolveDockSideForRect({ x: 668, width: 280 }, viewport),
      { minWidth: 180, minHeight: 180, maxWidth: 720, maxHeight: 860 },
      viewport,
      42,
    )).toEqual({ x: 668, y: 42, width: 280, height: 280 })
  })

  test('keeps a user-closed portrait closed for the same chat but reopens after chat changes', () => {
    expect(shouldAutoOpenPortraitForChat('chat-1', 'chat-1', false)).toBe(false)
    expect(shouldAutoOpenPortraitForChat('chat-2', 'chat-1', false)).toBe(true)
    expect(shouldAutoOpenPortraitForChat('chat-1', null, false)).toBe(true)
    expect(shouldAutoOpenPortraitForChat('chat-1', 'chat-1', true)).toBe(true)
  })

  test('restores natural image dimensions within available bounds', () => {
    expect(fitPortraitSize(
      2,
      { minWidth: 180, minHeight: 180, maxWidth: 500, maxHeight: 400 },
      'natural',
      { width: 1200, height: 600 },
    )).toEqual({ width: 500, height: 250 })
  })

  test('preserves a saved dock size when the portrait image initializes', () => {
    const bounds = { minWidth: 180, minHeight: 180, maxWidth: 720, maxHeight: 860 }
    const viewport = { width: 960, height: 900 }
    const savedRect = { x: 0, y: 24, width: 266, height: 832 }

    expect(resolveDockedPortraitImageRect(
      { width: 589, height: 832 },
      savedRect,
      'left',
      bounds,
      viewport,
    )).toEqual({ x: 12, y: 24, width: 266, height: 832 })
  })

  test('reclaims only the dock width outside the constrained chat gutter', () => {
    expect(getPortraitLayoutReclaim(960, 680, 280)).toBe(40)
  })

  test('does not retain the legacy docked offset transform', async () => {
    const css = await Bun.file(resolve(import.meta.dir, 'PortraitDock.module.css')).text()
    const chatCss = await Bun.file(resolve(import.meta.dir, 'ChatView.module.css')).text()
    const component = await Bun.file(resolve(import.meta.dir, 'PortraitDock.tsx')).text()

    expect(css).not.toContain('--portrait-dock-offset-y')
    expect(css).not.toMatch(/\.dockedDock\s*\{[^}]*transform:/s)
    expect(css).toMatch(/\.dockedDock\s*\{[^}]*align-self:\s*flex-start;/s)
    expect(chatCss).toContain("[data-surface-id='portrait_dock.workspace']")
    expect(chatCss).toMatch(/portrait_dock\.workspace'\]\)\s*\{\s*display:\s*contents;/s)
    expect(component).toContain("dockElement.closest<HTMLElement>('[data-chat-constrained]')")
  })

  test('limits extension previews to their matching chat and avatar context', () => {
    const preview = { chatId: 'chat-1', avatarId: 'avatar-1', imageUrl: 'preview.png' }

    expect(ownsPortraitPreviewForContext(preview, 'chat-1', 'avatar-1')).toBe(true)
    expect(ownsPortraitPreviewForContext(preview, 'chat-2', 'avatar-1')).toBe(false)
    expect(ownsPortraitPreviewForContext(preview, 'chat-1', 'avatar-2')).toBe(false)
    expect(ownsPortraitPreviewForContext(null, 'chat-1', 'avatar-1')).toBe(false)
  })

  test('keeps native image viewers isolated when the extension claims a preview', async () => {
    const component = await Bun.file(resolve(import.meta.dir, 'PortraitDock.tsx')).text()
    const nativeViewer = await Bun.file(resolve(import.meta.dir, 'FloatingAvatarViewer.tsx')).text()

    expect(portraitDockOwnsFloatingAvatar({ owner: 'portrait-dock' }, true)).toBe(true)
    expect(portraitDockOwnsFloatingAvatar({ owner: 'native' }, true)).toBe(false)
    expect(portraitDockOwnsFloatingAvatar({ owner: 'native' }, false)).toBe(true)
    expect(portraitDockOwnsFloatingAvatar(null, true)).toBe(false)
    expect(component).toMatch(/if \(!extensionOwned \|\| typeof window === 'undefined'\) return/s)
    expect(component).toMatch(/hostIntentEventName\('image-preview'\)[\s\S]*event\.preventDefault\(\)/s)
    expect(component).toMatch(/autoSyncedChatIdRef\.current === activeChatId[\s\S]*floatingAvatar\?\.owner === 'portrait-dock'/s)
    expect(component).toMatch(/!portraitDockOwnsFloatingAvatar\(floatingAvatar, extensionOwned\)/)
    expect(nativeViewer).toMatch(/if \(!floatingAvatar \|\| portraitDockOwnsAvatar\) return null/)
  })
})
