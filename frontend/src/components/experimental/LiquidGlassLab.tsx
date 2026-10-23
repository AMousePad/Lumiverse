import { useEffect, useRef } from 'react'

export default function LiquidGlassLab() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return () => {
      document.querySelectorAll('.tp-dfwv').forEach((n) => n.remove())
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="liquid-glass-lab"
      style={{ width: '100%', height: '100vh', background: '#0b0b10', overflow: 'auto' }}
    >
      <div className="lab-banner" style={{ padding: 16, color: '#ddd', fontFamily: 'system-ui' }}>
        <h1 style={{ margin: 0 }}>Liquid Glass Lab (experimental)</h1>
        <p style={{ opacity: 0.7, margin: '4px 0 0' }}>
          Staging-only experiment. SVG filters scoped to this route.
        </p>
      </div>
      <div dangerouslySetInnerHTML={{ __html: LAB_MARKUP }} />
      <style dangerouslySetInnerHTML={{ __html: LAB_CSS }} />
    </div>
  )
}

const LAB_MARKUP = `<main><button aria-label="toggle" aria-pressed="false" class="liquid-toggle"><div class="indicator__liquid"><div class="shadow"></div><div class="wrapper"><div class="liquids"><div class="liquid__shadow"></div><div class="liquid__track"></div></div></div><div class="cover"></div></div></button></main>`

const LAB_CSS = `.liquid-glass-lab main { display: grid; place-items: center; min-height: 60vh; } .liquid-glass-lab .liquid-toggle { --checked: hsl(144, 90%, 50%); --border: 5px; --width: 140; --height: 60; height: calc(var(--height) * 1px); width: calc(var(--width) * 1px); border-radius: 100px; border: 0; cursor: pointer; position: relative; overflow: visible; container-type: inline-size; background: #0000; } .liquid-glass-lab .indicator__liquid { position: absolute; height: calc(100% - (2 * var(--border))); width: calc(60% - (2 * var(--border))); top: 50%; background: #0000; left: var(--border); border-radius: 100px; transform: translate(0,-50%); } .liquid-glass-lab .liquids { position: absolute; inset: 0; border-radius: 100px; overflow: hidden; } .liquid-glass-lab .liquid__track { position: absolute; top: 50%; height: 60px; width: 100%; background: var(--checked); border-radius: 100px; transform: translate(0,-50%); } .liquid-glass-lab .cover { position: absolute; inset: 0; background: rgba(255,255,255,.85); border-radius: 100px; }`
