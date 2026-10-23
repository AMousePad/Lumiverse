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
