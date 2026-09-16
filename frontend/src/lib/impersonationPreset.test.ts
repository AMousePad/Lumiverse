import { describe, expect, test } from 'bun:test'

import { resolveImpersonationPresetSelection } from './impersonationPreset'

describe('impersonation preset selection', () => {
  test('keeps Preset Prompts on the active chat preset', () => {
    expect(resolveImpersonationPresetSelection('prompts', 'dedicated', 'active')).toEqual({
      presetId: 'active',
      forcePresetId: false,
    })
  })

  test.each(['preset', 'oneliner'] as const)(
    '%s uses and force-selects the dedicated impersonation preset',
    (mode) => {
      expect(resolveImpersonationPresetSelection(mode, 'dedicated', 'active')).toEqual({
        presetId: 'dedicated',
        forcePresetId: true,
      })
    },
  )

  test('falls back to the active preset when no dedicated preset is configured', () => {
    expect(resolveImpersonationPresetSelection('preset', null, 'active')).toEqual({
      presetId: 'active',
      forcePresetId: false,
    })
  })
})
