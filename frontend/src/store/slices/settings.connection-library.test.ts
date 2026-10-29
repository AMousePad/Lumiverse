import { afterEach, expect, test } from 'bun:test'
import { settingsApi } from '@/api/settings'
import type { AppStore, SettingsSlice } from '@/types/store'
import { createSettingsSlice, flushSettingsNow, resetSettingsPersistence } from './settings'

const original = { getAll: settingsApi.getAll, putMany: settingsApi.putMany }
const library = {
  folders: [{ id: 'local', name: 'Local' }], folderOrder: ['local', ''], assignments: { a: 'local' },
}

function setup() {
  const rows = new Map<string, unknown>([
    ['connectionLibraries', { llm: library, imageGen: library }],
    ['recentConnections', { llm: ['a'], imageGen: ['b'] }],
  ])
  settingsApi.getAll = async () => [...rows].map(([key, value]) => ({ key, value, updated_at: 1 }))
  settingsApi.putMany = async values => {
    for (const [key, value] of Object.entries(values)) rows.set(key, value)
    return Object.entries(values).map(([key, value]) => ({ key, value, updated_at: 1 }))
  }
  const app = {} as AppStore
  const set = (patch: Partial<SettingsSlice>) => Object.assign(app, patch)
  Object.assign(app, createSettingsSlice(set as never, () => app, {} as never))
  return { app, rows }
}

afterEach(() => {
  resetSettingsPersistence()
  localStorage.removeItem('__lumiverse_pending_settings')
  settingsApi.getAll = original.getAll
  settingsApi.putMany = original.putMany
})

test('settings reload keeps remote moves to Uncategorized and removal of a type', async () => {
  const { app, rows } = setup()
  await app.loadSettings()
  expect(app.connectionLibraries.llm?.assignments.a).toBe('local')
  const saved = { llm: { ...library, assignments: {} } }
  rows.set('connectionLibraries', saved)
  rows.set('recentConnections', { llm: [] })
  await app.loadSettings()
  expect(app.connectionLibraries).toEqual(saved)
  expect(app.recentConnections).toEqual({ llm: [] })

  app.setSetting('connectionLibraries', {
    ...app.connectionLibraries, llm: { ...app.connectionLibraries.llm!, folderOrder: ['', 'local'] },
  })
  await flushSettingsNow()
  expect(rows.get('connectionLibraries')).toEqual({ llm: { ...saved.llm, folderOrder: ['', 'local'] } })
})

test('reload recovers a pending removal as a full snapshot and persists it', async () => {
  const { app, rows } = setup()
  const pending = { llm: { ...library, assignments: {} } }
  localStorage.setItem('__lumiverse_pending_settings', JSON.stringify({ connectionLibraries: pending, recentConnections: {} }))
  await app.loadSettings()
  await flushSettingsNow()
  expect(app.connectionLibraries).toEqual(pending)
  expect(rows.get('connectionLibraries')).toEqual(pending)
  expect(app.recentConnections).toEqual({})
  expect(rows.get('recentConnections')).toEqual({})
})

test('a folder edit made during settings loading survives an older response', async () => {
  const { app } = setup()
  await app.loadSettings()
  let resolveRows!: (rows: Awaited<ReturnType<typeof settingsApi.getAll>>) => void
  settingsApi.getAll = () => new Promise(resolve => { resolveRows = resolve })
  const loading = app.loadSettings()
  const next = { llm: { ...library, assignments: {} } }
  app.setSetting('connectionLibraries', next)
  resolveRows([{ key: 'connectionLibraries', value: { llm: library }, updated_at: 1 }])
  await loading
  expect(app.connectionLibraries).toEqual(next)
})
