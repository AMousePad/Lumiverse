/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import type { AppStore, SavedThemePackEntry } from '@/types/store'
import { themeAssetsApi } from '@/api/theme-assets'
import { DEFAULT_THEME } from '@/theme/presets'
import { createSettingsSlice, resetSettingsPersistence } from './settings'

function createStore(): AppStore {
  const state = {} as AppStore
  const set = (partial: Partial<AppStore> | ((current: AppStore) => Partial<AppStore>)) => {
    Object.assign(state, typeof partial === 'function' ? partial(state) : partial)
  }
  const get = () => state
  Object.assign(state, createSettingsSlice(set as never, get, {} as never))
  return state
}

function legacyPack(name = 'Slate'): SavedThemePackEntry['pack'] {
  return {
    format: 2,
    name,
    author: '',
    description: '',
    createdAt: 1,
    bundleId: 'bundle-1',
    theme: { ...DEFAULT_THEME, id: 'slate', name },
    globalCSS: '.root { color: white; }',
    components: {},
    assets: [],
  }
}

afterEach(() => {
  mock.restore()
  resetSettingsPersistence()
})

describe('saved theme names', () => {
  test('deleting a backup preserves assets owned by another saved theme', async () => {
    const store = createStore()
    const pack = legacyPack()
    store.customCSS = { ...store.customCSS, bundleId: 'new-bundle' }
    store.savedThemes = [
      { kind: 'pack', id: 'original', name: 'Original', createdAt: 1, pack },
      { kind: 'pack', id: 'backup', name: 'Backup', createdAt: 2, pack,
        authoringSnapshot: { version: 1, globalEnabled: true, themeWasNull: false } },
    ]
    const list = spyOn(themeAssetsApi, 'list').mockResolvedValue([])
    const remove = spyOn(themeAssetsApi, 'delete').mockResolvedValue(undefined)

    await store.deleteSavedTheme('backup')

    expect(store.savedThemes.map((entry) => entry.id)).toEqual(['original'])
    expect(list).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    store.applySavedTheme('original')
    expect(store.customCSS.bundleId).toBe(pack.bundleId)
  })

  test.each(['active', 'saved'] as const)('cleanup preserves a bundle that becomes %s while listing assets', async (reference) => {
    const store = createStore()
    const pack = legacyPack()
    store.customCSS = { ...store.customCSS, bundleId: 'new-bundle' }
    store.savedThemes = [{ kind: 'pack', id: 'backup', name: 'Backup', createdAt: 1, pack }]
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof themeAssetsApi.list>>>()
    const list = spyOn(themeAssetsApi, 'list').mockReturnValue(pending.promise)
    const remove = spyOn(themeAssetsApi, 'delete').mockResolvedValue(undefined)

    const deleting = store.deleteSavedTheme('backup')
    expect(list).toHaveBeenCalledWith(pack.bundleId)
    if (reference === 'active') store.customCSS = { ...store.customCSS, bundleId: pack.bundleId }
    else store.savedThemes = [{ kind: 'pack', id: 'retained', name: 'Retained', createdAt: 2, pack }]
    pending.resolve([{ id: 'asset' }] as Awaited<ReturnType<typeof themeAssetsApi.list>>)
    await deleting

    expect(remove).not.toHaveBeenCalled()
  })

  test('deleting the last owner of an inactive bundle still cleans up its assets', async () => {
    const store = createStore()
    store.customCSS = { ...store.customCSS, bundleId: 'new-bundle' }
    store.savedThemes = [{ kind: 'pack', id: 'backup', name: 'Backup', createdAt: 1, pack: legacyPack() }]
    spyOn(themeAssetsApi, 'list').mockResolvedValue([{ id: 'asset' }] as Awaited<ReturnType<typeof themeAssetsApi.list>>)
    const remove = spyOn(themeAssetsApi, 'delete').mockResolvedValue(undefined)

    await store.deleteSavedTheme('backup')

    expect(store.savedThemes).toEqual([])
    expect(remove).toHaveBeenCalledWith('asset')
  })

  test('applying a backend backup restores disabled CSS and the default theme', () => {
    const store = createStore()
    store.theme = { ...DEFAULT_THEME, name: 'Changed' }
    store.savedThemes = [{
      kind: 'pack', id: 'backup', name: 'Backup', createdAt: 1,
      pack: { ...legacyPack(), theme: null },
      authoringSnapshot: { version: 1, globalEnabled: false, themeWasNull: true },
    }]
    store.applySavedTheme('backup')
    expect(store.theme).toBeNull()
    expect(store.customCSS.css).toBe('.root { color: white; }')
    expect(store.customCSS.enabled).toBe(false)
  })

  test('renaming an active bundle synchronizes the saved pack and live theme name', () => {
    const store = createStore()
    store.theme = { ...DEFAULT_THEME, id: 'slate', name: 'Slate' }
    store.customCSS = { ...store.customCSS, bundleId: 'bundle-1' }
    store.savedThemes = [{
      kind: 'pack',
      id: 'saved-pack',
      name: 'Slate',
      createdAt: 1,
      pack: legacyPack(),
    }]

    store.renameSavedTheme('saved-pack', 'Starry Elegance')

    const saved = store.savedThemes[0]
    expect(saved.name).toBe('Starry Elegance')
    expect(saved.kind).toBe('pack')
    if (saved.kind !== 'pack') throw new Error('Expected pack entry')
    expect(saved.pack.name).toBe('Starry Elegance')
    expect(saved.pack.theme?.name).toBe('Starry Elegance')
    expect(store.theme?.name).toBe('Starry Elegance')
  })

  test('applying legacy saved entries promotes the visible library name to the live theme', () => {
    const store = createStore()
    store.theme = { ...DEFAULT_THEME, name: 'Lumiverse Purple' }
    store.savedThemes = [
      {
        kind: 'config',
        id: 'saved-config',
        name: 'Void Bloom',
        createdAt: 1,
        theme: { ...DEFAULT_THEME, id: 'slate', name: 'Slate' },
      },
      {
        kind: 'pack',
        id: 'saved-pack',
        name: 'Honeyed Twilight',
        createdAt: 1,
        pack: legacyPack(),
      },
    ]

    store.applySavedTheme('saved-config')
    expect(store.theme?.name).toBe('Void Bloom')

    store.applySavedTheme('saved-pack')
    expect(store.theme?.name).toBe('Honeyed Twilight')
    expect(store.customCSS.bundleId).toBe('bundle-1')
  })
})
