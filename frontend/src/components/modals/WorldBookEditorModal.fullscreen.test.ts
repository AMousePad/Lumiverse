import { describe, expect, test } from 'bun:test'

const componentSource = await Bun.file(new URL('./WorldBookEditorModal.tsx', import.meta.url)).text()
const cssSource = await Bun.file(new URL('./WorldBookEditorModal.module.css', import.meta.url)).text()

describe('WorldBookEditorModal fullscreen contract', () => {
  test('toggles the fullscreen class from local editor state', () => {
    expect(componentSource).toContain('const [fullscreen, setFullscreen] = useState(false)')
    expect(componentSource).toContain('className={clsx(styles.modal, fullscreen && styles.fullscreen)}')
    expect(componentSource).toContain('onClick={() => setFullscreen((current) => !current)}')
    expect(componentSource).toContain("aria-pressed={fullscreen}")
  })

  test('uses the scale-compensated viewport height exactly once', () => {
    const fullscreenBlock = cssSource.match(/\.fullscreen\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(fullscreenBlock).toMatch(/height: var\(--app-scaled-viewport-height, calc\(100dvh \/ var\(--lumiverse-ui-scale, 1\)\)\);/)
    expect(fullscreenBlock).not.toMatch(/height:\s*calc\(var\(--app-scaled-viewport-height/)
  })
})
