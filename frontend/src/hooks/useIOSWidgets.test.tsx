import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import { act } from 'react'
import type { Root } from 'react-dom/client'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://lumiverse.example' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true })
const calls: { action: string; payload: any }[] = []
let needsEnrollment = true, available = true, unsaved = false, appState = 'active'
let pendingEnrollment: (() => Promise<Record<string, unknown>>) | undefined
let storeListener: ((state: any, previous: any) => void) | undefined
const events = new Map<string, () => void>()
mock.module('@/api/client', () => ({ post: async () => pendingEnrollment ? pendingEnrollment() : { registrationId: 'registration-1', credential: 'secret', accountId: 'owner' } }))
mock.module('@/lib/ios-native', () => ({ hasIOSNativeBridge: () => true, iosNativeRequest: async (action: string, payload: any) => {
  calls.push({ action, payload })
  if (action === 'widgets.configure' && payload.enrollment) needsEnrollment = false
  return { available, needsEnrollment, deviceId: 'installation-12345678' }
} }))
mock.module('@/store', () => ({ useStore: { subscribe: (listener: typeof storeListener) => { storeListener = listener; return () => { storeListener = undefined } } } }))
mock.module('@/store/slices/settings', () => ({ hasUnsavedSettings: () => unsaved }))
mock.module('@/ws/client', () => ({ wsClient: { on: (event: string, callback: () => void) => { events.set(event, callback); return () => { events.delete(event) } } } }))
mock.module('@/lib/ios-app-state', () => ({ getIOSAppState: () => appState, subscribeIOSAppState: () => () => {} }))
let root: Root, hook: typeof import('./useIOSWidgets').useIOSWidgets
beforeAll(async () => { hook = (await import('./useIOSWidgets')).useIOSWidgets })
beforeEach(async () => {
  calls.length = 0; events.clear(); needsEnrollment = true; available = true; unsaved = false; appState = 'active'; pendingEnrollment = undefined
  document.documentElement.style.setProperty('--lumiverse-primary', 'rgb(120, 80, 200)')
  root = (await import('react-dom/client')).createRoot(document.body.appendChild(document.createElement('div')))
})
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren() })
afterAll(() => { mock.restore(); dom.window.close() })
function Probe({ account }: { account: string | null | undefined }) { hook(account); return null }
async function render(account: string | null | undefined) { await act(async () => { root.render(<Probe account={account} />) }) }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 170)) }) }

test('enrollment occurs after auth resolution, then refreshes using a resolved native palette', async () => {
  await render(undefined); await settle(); expect(calls).toHaveLength(0)
  await render('owner'); await settle()
  expect(calls.map(c => c.action)).toEqual(['widgets.status', 'widgets.configure', 'widgets.configure', 'widgets.refresh'])
  const configured = calls.find(c => c.payload?.enrollment)
  expect(configured?.payload.serverOrigin).toBe('https://lumiverse.example')
  expect(configured?.payload.palette.accent).toBe('#7850c8')
});

test('supported enrolled clients reuse credentials, and older builds do no enrollment or refresh', async () => {
  needsEnrollment = false; await render('owner'); await settle()
  expect(calls.filter(c => c.payload?.enrollment)).toHaveLength(0)
  expect(calls.filter(c => c.action === 'widgets.refresh')).toHaveLength(1)
  await render(null); available = false; calls.length = 0
  await render('owner'); await settle()
  expect(calls.map(c => c.action)).toEqual(['widgets.status'])
});

test('logout clears native state even in the background and retires an in-flight enrollment', async () => {
  let resolve!: (value: Record<string, unknown>) => void
  pendingEnrollment = () => new Promise(done => { resolve = done })
  await render('owner'); await settle()
  appState = 'background'; await render(null)
  await act(async () => { resolve({ registrationId: 'late', accountId: 'owner' }) }); await settle()
  expect(calls.some(c => c.payload?.enrollment)).toBe(false)
  expect(calls.filter(c => c.action === 'widgets.configure').at(-1)?.payload.accountId).toBe(null)
  expect(calls.some(c => c.action === 'widgets.refresh')).toBe(false)
});

test('visibility changes invalidate immediately and wait for settings persistence before refreshing', async () => {
  needsEnrollment = false; await render('owner'); await settle(); calls.length = 0
  const favorites = ['lumi'], previous = { favorites, landingHiddenCharacterIds: [], characters: [], theme: null }
  unsaved = true
  storeListener?.({ ...previous, landingHiddenCharacterIds: ['lumi'] }, previous)
  expect(calls[0]?.action).toBe('widgets.invalidate')
  await settle(); expect(calls.some(c => c.action === 'widgets.refresh')).toBe(false)
  unsaved = false; events.get('SETTINGS_UPDATED')?.(); await settle()
  expect(calls.filter(c => c.action === 'widgets.refresh')).toHaveLength(1)
});
