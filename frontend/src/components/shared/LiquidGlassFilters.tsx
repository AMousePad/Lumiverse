import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { isLiquidGlassActive } from '@/lib/liquidGlass'

/**
 * SVG filter definitions for the liquid-glass material.
 *
 * The filter is inlined once for the whole document and referenced by id from
 * CSS (`backdrop-filter: … url(#liquid-glass-distort)`). It has to live in the
 * DOM rather than a stylesheet because CSS has no way to declare `feTurbulence`
 * or `feDisplacementMap` primitives.
 *
 * Ported from the displacement filter in dashersw/liquid-glass-js and the
 * freefrontend "iOS 26" studies the Appearance panel cites:
 * `liquid-glass-distort` refracts a surface backdrop through fractal noise,
 * which is what gives a pane its lens edge.
 *
 * Rendered only while the effect is active so the filter chain costs nothing
 * when the user has not opted in. `url(#…)` on a missing id is a no-op, so the
 * markup is safe to unmount at any time.
 */
export default function LiquidGlassFilters() {
  const theme = useStore((s) => s.theme)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  if (!isLiquidGlassActive(theme, reducedMotion)) return null

  return (
    <svg className="lumiverse-liquid-glass-defs" aria-hidden="true" focusable="false">
      <defs>
        <filter id="liquid-glass-distort" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.008" numOctaves="2" seed="92" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="0.6" result="softNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softNoise"
            scale="14"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  )
}
