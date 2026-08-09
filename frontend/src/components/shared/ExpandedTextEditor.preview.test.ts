import { describe, expect, test } from 'bun:test'

const componentSource = await Bun.file(new URL('./ExpandedTextEditor.tsx', import.meta.url)).text()
const cssSource = await Bun.file(new URL('./ExpandedTextEditor.module.css', import.meta.url)).text()

describe('ExpandedTextEditor Markdown preview', () => {
  test('toggles between the editor and the chat Markdown renderer', () => {
    expect(componentSource).toContain("import MessageContent from '@/components/chat/MessageContent'")
    expect(componentSource).toContain("const [showMarkdownPreview, setShowMarkdownPreview] = useState(false)")
    expect(componentSource).toContain('aria-pressed={showMarkdownPreview}')
    expect(componentSource).toContain('<MessageContent')
    expect(componentSource).toContain('disableInterceptors')
  })

  test('keeps the rendered preview scrollable inside the modal body', () => {
    const previewBlock = cssSource.match(/\.markdownPreview\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(previewBlock).toMatch(/overflow:\s*auto/)
    expect(previewBlock).toMatch(/min-height:\s*0/)
  })
})
