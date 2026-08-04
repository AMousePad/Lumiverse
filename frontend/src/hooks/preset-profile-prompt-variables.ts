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

export interface PresetProfilePromptVariableChange {
  target: PresetProfilePromptVariableTarget
  binding: PresetProfileBinding
}

const promptVariableChangeListeners = new Set<(change: PresetProfilePromptVariableChange) => void>()

export function subscribePresetProfilePromptVariableChanges(
  listener: (change: PresetProfilePromptVariableChange) => void,
): () => void {
  promptVariableChangeListeners.add(listener)
  return () => promptVariableChangeListeners.delete(listener)
}

export function getEffectivePromptVariableValues(
  presetId: string | undefined,
  presetValues: PromptVariableValues,
  binding: PresetProfileBinding | null,
): PromptVariableValues {
  if (binding && presetId && binding.preset_id === presetId) {
    return binding.prompt_variables ? structuredClone(binding.prompt_variables) : {}
  }
  return presetValues
}

export async function updatePresetProfilePromptVariables(
  api: PresetProfilePromptVariableApi,
  target: PresetProfilePromptVariableTarget,
  values: PromptVariableValues,
): Promise<PresetProfileBinding> {
  let binding: PresetProfileBinding
  switch (target.source) {
    case 'chat':
      binding = await api.updateChatPromptVariables(target.id, values)
      break
    case 'persona':
      binding = await api.updatePersonaPromptVariables(target.id, values)
      break
    case 'character':
      binding = await api.updateCharacterPromptVariables(target.id, values)
      break
    case 'connection':
      binding = await api.updateConnectionPromptVariables(target.id, values)
      break
    case 'defaults':
      binding = await api.updateDefaultsPromptVariables(target.id, values)
      break
  }
  const change = { target, binding }
  for (const listener of promptVariableChangeListeners) {
    try {
      listener(change)
    } catch {
      // The profile write is already committed. A stale consumer must not
      // turn that successful save into a modal error.
    }
  }
  return binding
}
