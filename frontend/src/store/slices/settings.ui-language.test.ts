import { afterEach, expect, test } from 'bun:test'
import type { AppStore } from '@/types/store'
import { settingsApi } from '@/api/settings'
import { createGenerationSlice } from './generation'
import { createSettingsSlice, flushSettingsNow, resetSettingsPersistence } from './settings'

const original = { getAll: settingsApi.getAll, putMany: settingsApi.putMany }

function store(): AppStore {
  const state = {} as AppStore
  const set = (value: Partial<AppStore> | ((current: AppStore) => Partial<AppStore>)) =>
    Object.assign(state, typeof value === 'function' ? value(state) : value)
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
  localStorage.removeItem('__lumiverse_pending_settings')
  settingsApi.getAll = original.getAll
  settingsApi.putMany = original.putMany
})

test('an explicit English selection persists and hydrates on another device without writing back', async () => {
  const rows = new Map<string, unknown>()
  database(rows)
  const desktop = store()
  desktop.setSetting('uiLanguage', 'en')
  await flushSettingsNow()
  expect(rows.get('uiLanguage')).toBe('en')

  let writtenLanguage = false
  settingsApi.putMany = async values => {
    writtenLanguage ||= Object.hasOwn(values, 'uiLanguage')
    return []
  }
  const phone = store()
  await phone.loadSettings()
  expect(phone.uiLanguage).toBe('en')
  await flushSettingsNow()
  expect(writtenLanguage).toBe(false)
})

test('device detection never seeds an account without an explicit preference', async () => {
  const rows = new Map<string, unknown>()
  database(rows)
  const phone = store()
  await phone.loadSettings()
  await flushSettingsNow()
  expect(phone.uiLanguage).toBeNull()
  expect(rows.has('uiLanguage')).toBe(false)
})

test('ignores malformed server and pending recovery language values', async () => {
  for (const value of ['xx', '', null, 1, ['en'], { language: 'fr' }]) {
    resetSettingsPersistence()
    database(new Map([['uiLanguage', value]]))
    localStorage.setItem('__lumiverse_pending_settings', JSON.stringify({ uiLanguage: value }))
    const app = store()
    await app.loadSettings()
    expect(app.uiLanguage).toBeNull()
  }
})

test('a selection made during settings hydration wins over the older server language', async () => {
  let resolveRows!: (rows: Awaited<ReturnType<typeof settingsApi.getAll>>) => void
  settingsApi.getAll = () => new Promise(resolve => { resolveRows = resolve })
  const app = store()
  const loading = app.loadSettings()
  app.setSetting('uiLanguage', 'en')
  resolveRows([{ key: 'uiLanguage', value: 'fr', updated_at: 1 }])
  await loading
  expect(app.uiLanguage).toBe('en')
})
