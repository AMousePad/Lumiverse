import { describe, expect, test } from 'bun:test'
import { computeGroups, importFromSTPreset, marshalPreset } from './service'

describe('SillyTavern preset import', () => {
  test('keeps prompts grouped under sequential ━ category headings', () => {
    const preset = importFromSTPreset({
      prompts: [
        { identifier: 'category-one', name: '━━━━ OOC ━━━', content: '' },
        { identifier: 'ooc-tone', name: 'Tone', content: 'Write vividly.' },
        { identifier: 'ooc-style', name: 'Style', content: 'Use prose.' },
        { identifier: 'category-two', name: '━━━━ Optional', content: '' },
        { identifier: 'optional-detail', name: 'Detailing', content: 'Be specific.' },
      ],
      prompt_order: {
        100001: {
          order: [
            { identifier: 'category-one', enabled: true },
            { identifier: 'ooc-tone', enabled: true },
            { identifier: 'ooc-style', enabled: false },
            { identifier: 'category-two', enabled: true },
            { identifier: 'optional-detail', enabled: true },
          ],
        },
      },
    }, 'Celia')

    const categoryOne = preset.blocks.find((block) => block.name === '━━━━ OOC ━━━')!
    const categoryTwo = preset.blocks.find((block) => block.name === '━━━━ Optional')!
    const tone = preset.blocks.find((block) => block.name === 'Tone')!
    const style = preset.blocks.find((block) => block.name === 'Style')!
    const detail = preset.blocks.find((block) => block.name === 'Detailing')!

    expect(categoryOne.marker).toBe('category')
    expect(categoryTwo.marker).toBe('category')
    expect([tone.group, style.group]).toEqual([categoryOne.id, categoryOne.id])
    expect(detail.group).toBe(categoryTwo.id)
    expect(computeGroups(preset.blocks).map((group) => ({
      category: group.categoryBlock?.name,
      children: group.children.map((block) => block.name),
    }))).toEqual(expect.arrayContaining([
      { category: '━━━━ OOC ━━━', children: ['Tone', 'Style'] },
      { category: '━━━━ Optional', children: ['Detailing', 'Chat History'] },
    ]))
  })

  test('keeps extension data such as JS-Slash-Runner scripts as passthrough metadata', () => {
    const tavernHelper = {
      scripts: [{ type: 'script', enabled: true, name: 'Panel', id: 'script-1', content: 'console.log(1)', info: '', button: { enabled: true, buttons: [{ name: 'Open', visible: true }] }, data: {} }],
      variables: {},
    }
    const toolkit = { presetPromptGroups: [{ name: 'Mode', ids: ['ooc-tone'] }] }
    const preset = importFromSTPreset({
      prompts: [{ identifier: 'ooc-tone', name: 'Tone', content: 'Write vividly.' }],
      extensions: {
        regex_scripts: [{ scriptName: 'Hide', findRegex: '<x>', replaceString: '' }],
        tavern_helper: tavernHelper,
        otherToolkit: toolkit,
        source: { type: 'spoofed' },
        _lumiverse_install_source: 'lumihub',
      },
    }, 'Scripted')

    expect(preset.passthroughMetadata).toEqual({ tavern_helper: tavernHelper, otherToolkit: toolkit })
    expect(preset.source?.type).toBe('st_import')
    expect(preset.lumihubMeta).toBeNull()

    const metadata = marshalPreset(preset).metadata as Record<string, unknown>
    expect(metadata.tavern_helper).toEqual(tavernHelper)
    expect(metadata.otherToolkit).toEqual(toolkit)
    expect(metadata).not.toHaveProperty('regex_scripts')
    expect((metadata.source as { type?: string }).type).toBe('st_import')
  })

  test('imports presets without extensions with empty passthrough metadata', () => {
    const preset = importFromSTPreset({
      prompts: [{ identifier: 'ooc-tone', name: 'Tone', content: 'Write vividly.' }],
    }, 'Plain')
    expect(preset.passthroughMetadata).toEqual({})
    const malformed = importFromSTPreset({
      prompts: [{ identifier: 'ooc-tone', name: 'Tone', content: 'Write vividly.' }],
      extensions: ['not', 'a', 'record'] as unknown as Record<string, unknown>,
    }, 'Malformed')
    expect(malformed.passthroughMetadata).toEqual({})
  })
})
