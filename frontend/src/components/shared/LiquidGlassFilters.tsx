import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { isLiquidGlassActive, LENS_NORMAL_MAP } from '@/lib/liquidGlass'

/**
 * SVG filter definitions for the liquid-glass material.
 *
 * The filters are inlined once for the whole document and referenced by id from
 * CSS. They have to live in the DOM rather than a stylesheet because CSS has no
 * way to declare `feTurbulence`, `feImage`, or `feDisplacementMap` primitives.
 *
 * Two filters, both ported from the references the Appearance panel cites:
 *
 * - `liquid-glass-distort` refracts a whole surface backdrop through fractal
 *   noise, giving a pane its lens edge (dashersw/liquid-glass-js; the "Apple
 *   Liquid Glass UI" study uses the same turbulence/scale-70 recipe).
 * - `liquid-glass-lens` is a small radial normal map that bulges a slider thumb
 *   like a bead of glass, from the "Slider Button Liquid Glass" study. It keys
 *   off `filter:`, not `backdrop-filter:`, so it composes with the thumb's own
 *   backdrop blur instead of competing with it for the one displacement slot.
 *
 * Rendered only while the effect is active so the filter chains cost nothing
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
          <feGaussianBlur in="noise" stdDeviation="2" result="softNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softNoise"
            scale="70"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        <filter id="liquid-glass-lens" x="-50%" y="-50%" width="200%" height="200%">
          <feImage
            x="0"
            y="0"
            result="normalMap"
            href={LENS_NORMAL_MAP}
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="normalMap"
            scale="-252"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  )
}
