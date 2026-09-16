import type { ImpersonateMode } from '@/api/generate'

export type ImpersonationPreference = Extract<ImpersonateMode, 'prompts' | 'preset' | 'oneliner'>

export const DEFAULT_IMPERSONATION_MODE: ImpersonationPreference = 'oneliner'

export interface ImpersonationPresetSelection {
  presetId: string | undefined
  forcePresetId: boolean
}

/** Safely read the untyped per-chat metadata value. */
export function resolveImpersonationMode(value: unknown): ImpersonationPreference {
  return value === 'prompts' || value === 'preset' || value === 'oneliner'
    ? value
    : DEFAULT_IMPERSONATION_MODE
}

/**
 * The dedicated chat impersonation preset is shared by the full-preset and
 * one-liner actions. Preset Prompts intentionally keeps using the chat's
 * active preset so adding the new action cannot change existing behavior.
 */
export function resolveImpersonationPresetSelection(
  mode: ImpersonateMode,
  impersonationPresetId: string | null | undefined,
  activePresetId: string | null | undefined,
): ImpersonationPresetSelection {
  const dedicatedPresetId =
    mode === 'preset' || mode === 'oneliner'
      ? impersonationPresetId || undefined
      : undefined

  return {
    presetId: dedicatedPresetId || activePresetId || undefined,
    forcePresetId: !!dedicatedPresetId,
  }
}
