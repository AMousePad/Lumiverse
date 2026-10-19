/// <reference types="bun-types" />

import { describe, expect, mock, test } from 'bun:test'
import { isOpaqueThemeColor, toOpaqueRgb, withPreservedAlpha } from '../theme/themeColor'
import type { CharacterThemeOverlay, ThemeConfig } from '../types/theme'

mock.module('@/store', () => ({
  useStore: Object.assign(() => undefined, { getState: () => ({}) }),
}))

const { buildResolvedThemeVars, resolveDesktopSurfaceColor, resolveDesktopSurface } = await import('./useThemeApplicator')

describe('toOpaqueRgb', () => {
  test('converts character-aware CSS Color 4 RGB values for native PWA chrome', () => {
    expect(toOpaqueRgb('rgb(18 14 22)')).toBe('rgb(18, 14, 22)')
    expect(toOpaqueRgb(' #112233ff ')).toBe('rgb(17, 34, 51)')
  })

  test('supports slash alpha in space-separated RGB values', () => {
    expect(toOpaqueRgb('rgb(18 14 22 / 50%)')).toBe('rgb(9, 7, 11)')
  })

  test('keeps supporting legacy comma-separated RGBA values', () => {
    expect(toOpaqueRgb('rgba(18, 14, 22, 0.5)')).toBe('rgb(9, 7, 11)')
  })

  test('keeps supporting the HSL values emitted by built-in themes', () => {
    expect(toOpaqueRgb('hsla(0, 0%, 50%, 0.5)')).toBe('rgb(64, 64, 64)')
  })
})

describe('withPreservedAlpha', () => {
  test('uses the live palette color while retaining the configured tint opacity', () => {
    expect(withPreservedAlpha('rgb(18 14 22)', 'rgb(16 12 28 / 72%)'))
      .toBe('rgb(18 14 22 / 0.72)')
  })

  test('returns no recolor when the saved tint is not parseable', () => {
    expect(withPreservedAlpha('rgb(18 14 22)', 'not-a-color')).toBeNull()
  })
})

describe('character-aware desktop tint', () => {
  test('uses the active character palette while retaining the configured opacity', () => {
    const theme: ThemeConfig = {
      id: 'character-aware',
      name: 'Character Aware',
      mode: 'dark',
      accent: { h: 263, s: 55, l: 65 },
      radiusScale: 1,
      enableGlass: true,
      fontScale: 1,
      characterAware: true,
      desktopBackground: { color: 'rgb(16 12 28 / 72%)' },
    }
    const characterPalette: CharacterThemeOverlay = {
      accent: { h: 340, s: 70, l: 60 },
      baseColors: { backgroundDeep: 'rgb(18 14 22)' },
      baseColorsLight: { backgroundDeep: 'rgb(235 229 238)' },
    }

    const resolved = buildResolvedThemeVars(theme, characterPalette, {}, {}, 'dark')

    expect(resolved.hasPaletteOverride).toBeTrue()
    expect(resolveDesktopSurfaceColor(resolved.config, resolved.vars, resolved.hasPaletteOverride))
      .toBe('rgb(18 14 22 / 0.72)')
  })

  test('keeps the configured tint until a character palette is available', () => {
    const theme: ThemeConfig = {
      id: 'character-aware',
      name: 'Character Aware',
      mode: 'dark',
      accent: { h: 263, s: 55, l: 65 },
      radiusScale: 1,
      enableGlass: true,
      fontScale: 1,
      characterAware: true,
      desktopBackground: { color: 'rgb(16 12 28 / 72%)' },
    }

    const resolved = buildResolvedThemeVars(theme, null, {}, {}, 'dark')

    expect(resolved.hasPaletteOverride).toBeFalse()
    expect(resolveDesktopSurfaceColor(resolved.config, resolved.vars, resolved.hasPaletteOverride))
      .toBe('rgb(16 12 28 / 72%)')
  })
})


describe('native desktop surface policy', () => {
  const config: ThemeConfig = {
    id: 'surface', name: 'Surface', mode: 'dark', accent: { h: 263, s: 55, l: 65 },
    radiusScale: 1, enableGlass: false, fontScale: 1,
  }

  test.each(['#123', '#112233ff', 'rgb(18 14 22)', 'rgba(18, 14, 22, 1)', 'hsl(0, 0%, 50%)'])(
    'uses an opaque host for an opaque theme: %s', (color) => {
      const surface = resolveDesktopSurface({ ...config, desktopBackground: { color, blur: true } }, {}, false)
      expect(surface.surfaceMode).toBe('opaque')
      expect(surface.blur).toBeFalse()
    },
  )

  test.each(['#1238', 'rgb(18 14 22 / 75%)', 'transparent', 'var(--surface)', 'var(--surface, hsl(0, 0%, 50%))', '#gggggg'])(
    'preserves translucency or an unknown CSS color: %s', (color) => {
      expect(isOpaqueThemeColor(color)).toBeFalse()
      expect(resolveDesktopSurface({ ...config, desktopBackground: { color, blur: true } }, {}, false).surfaceMode)
        .toBe('translucent')
    },
  )

  test('efficiency makes both the native host and page opaque, even for unparseable colors', () => {
    const surface = resolveDesktopSurface({ ...config, renderingMode: 'efficiency', desktopBackground: { color: 'var(--unknown)', blur: true } }, {}, false)
    expect(surface).toEqual({ surfaceMode: 'opaque', background: 'rgb(10, 8, 18)', nativeColor: [10, 8, 18], blur: false })
  })

  test('uses the resolved palette rather than assuming that a missing desktop tint is opaque', () => {
    expect(resolveDesktopSurface(config, { '--lumiverse-bg-deep': 'rgb(1 2 3 / 50%)' }, false).surfaceMode).toBe('translucent')
    expect(resolveDesktopSurface(config, { '--lumiverse-bg-deep': '#121212' }, false).surfaceMode).toBe('opaque')
  })

  test('character recoloring retains the transparency decision', () => {
    const themed = { ...config, desktopBackground: { color: 'rgb(81 26 42 / 75%)', blur: true } }
    const surface = resolveDesktopSurface(themed, { '--lumiverse-bg-deep': 'rgb(18 14 22)' }, true)
    expect(surface.surfaceMode).toBe('translucent')
    expect(surface.blur).toBeTrue()
    expect(surface.nativeColor).toEqual([14, 11, 17])
  })
})
