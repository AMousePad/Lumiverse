import { describe, expect, mock, test } from 'bun:test'
import type { PresetProfileBinding } from '@/api/preset-profiles'
import type { PromptVariableValues } from '@/lib/loom/types'
import {
  getEffectivePromptVariableValues,
  mergePromptVariableValues,
  updatePresetProfilePromptVariables,
  type PresetProfilePromptVariableSource,
} from './preset-profile-prompt-variables'

const values: PromptVariableValues = { block: { tone: 'warm' } }
const binding: PresetProfileBinding = {
  preset_id: 'preset-1',
  block_states: { block: true },
  prompt_variables: values,
  captured_at: 1,
}

describe('preset profile prompt variables', () => {
  test('accepts an absent profile snapshot while presets and bindings are loading', () => {
    expect(getEffectivePromptVariableValues(undefined, {}, null)).toEqual({})
  })

  test('merges profile values over preset defaults without dropping unrelated values', () => {
    expect(mergePromptVariableValues(
      { block: { tone: 'neutral', length: 2 }, other: { style: 'plain' } },
      { block: { tone: 'warm' } },
    )).toEqual({
      block: { tone: 'warm', length: 2 },
      other: { style: 'plain' },
    })
  })

  test.each([
    ['chat', 'updateChatPromptVariables'],
    ['persona', 'updatePersonaPromptVariables'],
    ['character', 'updateCharacterPromptVariables'],
    ['connection', 'updateConnectionPromptVariables'],
    ['defaults', 'updateDefaultsPromptVariables'],
  ] as const)('routes %s saves to its profile endpoint', async (source, expectedMethod) => {
    const api = {
      updateChatPromptVariables: mock(async () => binding),
      updatePersonaPromptVariables: mock(async () => binding),
      updateCharacterPromptVariables: mock(async () => binding),
      updateConnectionPromptVariables: mock(async () => binding),
      updateDefaultsPromptVariables: mock(async () => binding),
    }

    await expect(updatePresetProfilePromptVariables(
      api,
      { source: source as PresetProfilePromptVariableSource, id: 'profile-1' },
      values,
    )).resolves.toEqual(binding)

    expect(api[expectedMethod]).toHaveBeenCalledWith('profile-1', values)
    expect(Object.values(api).reduce((count, fn) => count + fn.mock.calls.length, 0)).toBe(1)
  })
})
