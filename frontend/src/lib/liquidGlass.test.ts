import { describe, expect, test } from 'bun:test'
import { isLiquidGlassActive, LENS_NORMAL_MAP } from './liquidGlass'
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

/**
 * The lens normal map is consumed as the `href` of an SVG `feImage`. A raw `#`
 * inside a data URI opens a fragment, so the browser loads only the part before
 * it, the SVG fails to parse, and the displacement silently becomes a no-op.
 * These assertions keep the encoded form that actually renders.
 */
describe('LENS_NORMAL_MAP data URI', () => {
  test('percent-encodes the fragment so the SVG parses', () => {
    expect(LENS_NORMAL_MAP).toContain('url(%23invmap)')
    expect(LENS_NORMAL_MAP).not.toContain('url(#invmap)')
  })

  test('percent-encodes the percentage signs in the geometry attributes', () => {
    expect(LENS_NORMAL_MAP).toContain("cx='50%25'")
    expect(LENS_NORMAL_MAP).not.toContain("cx='50%'")
  })

  test('decodes to a single well-formed radial-gradient SVG', () => {
    const svg = decodeURIComponent(LENS_NORMAL_MAP.slice(LENS_NORMAL_MAP.indexOf(',') + 1))
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).toContain("fill='url(#invmap)'")
  })
})
