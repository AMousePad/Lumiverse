/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from 'bun:test'
import type { AppStore } from '@/types/store'
import { settingsApi } from '@/api/settings'
import { createGenerationSlice } from './generation'
import {
  createSettingsSlice,
  flushSettingsNow,
  resetSettingsPersistence,
  shouldReloadSettingsAfterUpdate,
} from './settings'

const original = { getAll: settingsApi.getAll, putMany: settingsApi.putMany }

function store(): AppStore {
  const state = {} as AppStore
  const set = (value: Partial<AppStore> | ((current: AppStore) => Partial<AppStore>)) => Object.assign(state, typeof value === 'function' ? value(state) : value)
  const get = () => state
  Object.assign(state, createGenerationSlice(set as never, get, {} as never))
  Object.assign(state, createSettingsSlice(set as never, get, {} as never))
  return state
}

function database(rows: Map<string, unknown>) {
  settingsApi.getAll = async () => [...rows].map(([key, value]) => ({ key, value, updated_at: 1 }))
  settingsApi.putMany = async values => {
    for (const [key, value] of Object.entries(values)) rows.set(key, value)
    return Object.entries(values).map(([key, value]) => ({ key, value, updated_at: 1 }))
  }
}

afterEach(() => {
  resetSettingsPersistence()
  settingsApi.getAll = original.getAll
  settingsApi.putMany = original.putMany
})

describe('portrait dock persistence', () => {
  test('restores canonical open state and geometry after reload', async () => {
    const rows = new Map<string, unknown>()
    database(rows)
    const first = store()
    const saved = { ...first.portraitDockSettings, open: true, dockSide: 'left' as const, rect: { x: 24, y: 48, width: 284, height: 412 } }
    first.setSetting('portraitDockSettings', saved)
    await flushSettingsNow()

    const restored = store()
    await restored.loadSettings()
    expect(restored.portraitDockSettings).toEqual(saved)
  })

  test('does not replace canonical geometry with a stale private fallback', async () => {
    const saved = { ...store().portraitDockSettings, open: false, dockSide: 'left' as const, rect: { x: 24, y: 48, width: 284, height: 412 } }
    const rows = new Map<string, unknown>([
      ['portraitDockSettings', saved],
      ['spindle:lumiverse_suite:portrait_dock:portraitDockSettings', { ...saved, open: true, dockSide: 'right', rect: { x: 0, y: 0, width: 360, height: 520 } }],
    ])
    database(rows)
    const restored = store()
    await restored.loadSettings()
    expect(restored.portraitDockSettings).toEqual(saved)
  })

  test('does not PUT a matching private fallback after canonical reload', async () => {
    const saved = { ...store().portraitDockSettings, open: true, dockSide: 'left' as const }
    const rows = new Map<string, unknown>([
      ['portraitDockSettings', saved],
      ['spindle:lumiverse_suite:portrait_dock:portraitDockSettings', saved],
    ])
    database(rows)
    let puts = 0
    settingsApi.putMany = async values => {
      puts += 1
      for (const [key, value] of Object.entries(values)) rows.set(key, value)
      return []
    }

    await store().loadSettings()
    await flushSettingsNow()

    expect(puts).toBe(0)
  })

  test('repairs a mismatched private fallback from the canonical row', async () => {
    const saved = { ...store().portraitDockSettings, open: false, dockSide: 'left' as const }
    const privateKey = 'spindle:lumiverse_suite:portrait_dock:portraitDockSettings'
    const rows = new Map<string, unknown>([
      ['portraitDockSettings', saved],
      [privateKey, { ...saved, open: true, dockSide: 'right' }],
    ])
    database(rows)

    await store().loadSettings()
    await flushSettingsNow()

    expect(rows.get(privateKey)).toEqual(saved)
  })

  test('consumes one matching own websocket echo and reloads for the next or unrelated event', async () => {
    const first = store()
    const saved = { ...first.portraitDockSettings, open: true }
    const privateKey = 'spindle:lumiverse_suite:portrait_dock:portraitDockSettings'
    database(new Map())
    first.setSetting('portraitDockSettings', saved)
    await flushSettingsNow()

    expect(shouldReloadSettingsAfterUpdate({ keys: ['portraitDockSettings', privateKey] })).toBe(false)
    expect(shouldReloadSettingsAfterUpdate({ keys: ['portraitDockSettings', privateKey] })).toBe(true)
    expect(shouldReloadSettingsAfterUpdate({ keys: ['theme'] })).toBe(true)
  })
})
