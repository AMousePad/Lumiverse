import { describe, expect, test } from 'bun:test'
import { shouldHideQuickToolbarWhenOverlaid } from '@/lib/uiProductivityDefaults'

const base = {
  activeModal: null,
  settingsModalOpen: false,
  drawerOpen: false,
  characterEditorOpen: false,
  lorebookHalfEditorOpen: false,
  lorebookWorkspaceOpen: false,
}

describe('Quick Toolbar overlay visibility', () => {
  test('uses the mobile-aware default for every real overlay surface', () => {
    for (const overlay of ['activeModal', 'settingsModalOpen', 'drawerOpen', 'characterEditorOpen', 'lorebookHalfEditorOpen', 'lorebookWorkspaceOpen'] as const) {
      const state = { ...base, [overlay]: overlay === 'activeModal' ? 'characterEditor' : true }
      expect(shouldHideQuickToolbarWhenOverlaid({ ...state, hideWhenOverlaid: undefined, isMobile: true })).toBe(true)
      expect(shouldHideQuickToolbarWhenOverlaid({ ...state, hideWhenOverlaid: undefined, isMobile: false })).toBe(false)
    }
  })

  test('lets an explicit preference override the responsive default', () => {
    expect(shouldHideQuickToolbarWhenOverlaid({ ...base, drawerOpen: true, hideWhenOverlaid: true, isMobile: false })).toBe(true)
    expect(shouldHideQuickToolbarWhenOverlaid({ ...base, drawerOpen: true, hideWhenOverlaid: false, isMobile: true })).toBe(false)
  })
})
