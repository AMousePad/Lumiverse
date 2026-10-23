import { describe, expect, test } from 'bun:test'
import { isLiquidGlassActive } from './liquidGlass'
import type { ThemeConfig } from '@/types/theme'

const base: Pick<ThemeConfig, 'enableGlass' | 'liquidGlass' | 'renderingMode'> = {
  enableGlass: true,
  liquidGlass: true,
  renderingMode: 'balanced',
}

describe('isLiquidGlassActive', () => {
  test('activates only when the opt-in flag is set', () => {
    expect(isLiquidGlassActive(base, false)).toBe(true)
    expect(isLiquidGlassActive({ ...base, liquidGlass: false }, false)).toBe(false)
    expect(isLiquidGlassActive({ ...base, liquidGlass: undefined }, false)).toBe(false)
  })

  test('never activates without the frosted glass layer it refracts', () => {
    expect(isLiquidGlassActive({ ...base, enableGlass: false }, false)).toBe(false)
  })

  test('stands down in efficiency mode, which strips backdrop filters', () => {
    expect(isLiquidGlassActive({ ...base, renderingMode: 'efficiency' }, false)).toBe(false)
    expect(isLiquidGlassActive({ ...base, renderingMode: 'quality' }, false)).toBe(true)
    expect(isLiquidGlassActive({ ...base, renderingMode: undefined }, false)).toBe(true)
  })

  test('honours the reduced-motion preference', () => {
    expect(isLiquidGlassActive(base, true)).toBe(false)
  })

  test('treats a missing theme as inactive', () => {
    expect(isLiquidGlassActive(null, false)).toBe(false)
    expect(isLiquidGlassActive(undefined, false)).toBe(false)
  })
})
