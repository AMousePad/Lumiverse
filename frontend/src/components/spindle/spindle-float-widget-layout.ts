import type { CSSProperties } from 'react'

export const FULLSCREEN_FLOAT_WIDGET_STYLE = {
  left: 0,
  top: 0,
  width: 'var(--app-scaled-viewport-width, calc(100vw / var(--lumiverse-ui-scale, 1)))',
  height: 'var(--app-scaled-viewport-height, calc(100vh / var(--lumiverse-ui-scale, 1)))',
} satisfies CSSProperties

export function resolveFloatWidgetStyle(
  fullscreen: boolean,
  position: { x: number; y: number },
  size: { width: number; height: number },
): CSSProperties {
  if (fullscreen) return FULLSCREEN_FLOAT_WIDGET_STYLE

  return {
    left: position.x,
    top: position.y,
    width: size.width,
    height: size.height,
  }
}
