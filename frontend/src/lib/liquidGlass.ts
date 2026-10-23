import type { ThemeConfig } from '@/types/theme'

/**
 * Whether the liquid-glass material should paint.
 *
 * Liquid glass is a second, more expensive layer on top of the frosted
 * `enableGlass` material: it refracts the backdrop with an SVG displacement
 * filter instead of only blurring it. It therefore inherits every one of
 * glass's own gates — plain glass must be on, efficiency rendering must be
 * off (it strips all backdrop filters), and the user must not have asked for
 * reduced motion. Keeping the predicate in one place means the settings panel,
 * the theme applicator, and the SVG filter host can never disagree about
 * whether the effect is live.
 */
export function isLiquidGlassActive(
  config: Pick<ThemeConfig, 'enableGlass' | 'liquidGlass' | 'renderingMode'> | null | undefined,
  prefersReducedMotion: boolean,
): boolean {
  if (!config?.liquidGlass || !config.enableGlass) return false
  if (config.renderingMode === 'efficiency') return false
  return !prefersReducedMotion
}

/**
 * Radial normal map for the slider lens: mid-blue at the centre ramping to
 * white at the rim, which `feDisplacementMap` reads as an outward bulge.
 *
 * The `#` and `%` characters are percent-encoded because this string is used as
 * the `href` of an SVG `feImage`. Inside a data URI a raw `#` opens a fragment,
 * so the browser loads only the part before it, the SVG fails to parse, and the
 * lens silently degrades to a no-op. Kept as a tiny inline SVG rather than a
 * base64 raster so it stays legible and costs ~300 bytes.
 */
export const LENS_NORMAL_MAP =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'>" +
  "<radialGradient id='invmap' cx='50%25' cy='50%25' r='75%25'>" +
  "<stop offset='0%25' stop-color='rgb(128,128,255)'/>" +
  "<stop offset='90%25' stop-color='rgb(255,255,255)'/>" +
  "</radialGradient><rect width='100%25' height='100%25' fill='url(%23invmap)'/></svg>"
