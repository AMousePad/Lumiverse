import type { PresetProfileBinding } from '@/api/preset-profiles'
import type { PromptVariableValues } from '@/lib/loom/types'

export type PresetProfilePromptVariableSource = 'chat' | 'persona' | 'character' | 'connection' | 'defaults'

export interface PresetProfilePromptVariableTarget {
  source: PresetProfilePromptVariableSource
  id: string
}

interface PresetProfilePromptVariableApi {
  updateChatPromptVariables(id: string, values: PromptVariableValues): Promise<PresetProfileBinding>
  updatePersonaPromptVariables(id: string, values: PromptVariableValues): Promise<PresetProfileBinding>
  updateCharacterPromptVariables(id: string, values: PromptVariableValues): Promise<PresetProfileBinding>
  updateConnectionPromptVariables(id: string, values: PromptVariableValues): Promise<PresetProfileBinding>
  updateDefaultsPromptVariables(id: string, values: PromptVariableValues): Promise<PresetProfileBinding>
}

export function mergePromptVariableValues(
  presetValues: PromptVariableValues,
  profileValues: PromptVariableValues | undefined,
): PromptVariableValues {
  if (!profileValues) return presetValues
  const merged: PromptVariableValues = {}
  for (const [blockId, values] of Object.entries(presetValues)) merged[blockId] = { ...values }
  for (const [blockId, values] of Object.entries(profileValues)) {
    merged[blockId] = { ...(merged[blockId] ?? {}), ...values }
  }
  return merged
}

export function getEffectivePromptVariableValues(
  presetId: string | undefined,
  presetValues: PromptVariableValues,
  binding: PresetProfileBinding | null,
): PromptVariableValues {
  return mergePromptVariableValues(
    presetValues,
    binding && presetId && binding.preset_id === presetId
      ? binding.prompt_variables
      : undefined,
  )
}

export function updatePresetProfilePromptVariables(
  api: PresetProfilePromptVariableApi,
  target: PresetProfilePromptVariableTarget,
  values: PromptVariableValues,
): Promise<PresetProfileBinding> {
  switch (target.source) {
    case 'chat':
      return api.updateChatPromptVariables(target.id, values)
    case 'persona':
      return api.updatePersonaPromptVariables(target.id, values)
    case 'character':
      return api.updateCharacterPromptVariables(target.id, values)
    case 'connection':
      return api.updateConnectionPromptVariables(target.id, values)
    case 'defaults':
      return api.updateDefaultsPromptVariables(target.id, values)
  }
}
