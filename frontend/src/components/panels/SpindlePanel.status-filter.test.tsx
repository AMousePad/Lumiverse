import { afterEach, beforeAll, expect, mock, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import { act, type ReactNode } from 'react'
import type { Root, createRoot as CreateRoot } from 'react-dom/client'
import { create } from 'zustand'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import type { ExtensionInfo } from 'lumiverse-spindle-types'
import type { ExtensionUpdateInfo } from '@/types/spindle-updates'
import panels from '../../i18n/locales/en/panels.json'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  MouseEvent: dom.window.MouseEvent,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
})
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })

const fixture: ExtensionInfo = {
  id: 'active', identifier: 'active', name: 'Active Toolkit', version: '1.0.0', author: 'Author',
  description: '', github: '', homepage: '', permissions: [], granted_permissions: [],
  enabled: true, installed_at: 0, updated_at: 0, has_frontend: false, has_backend: true,
  status: 'running', metadata: {},
}
const fixtures = [fixture, { ...fixture, id: 'inactive', name: 'Inactive Realm', enabled: false, status: 'stopped' as const }]
const store = create(() => ({
  extensions: fixtures,
  spindlePrivileged: true,
  user: null,
  extensionUpdates: [] as ExtensionUpdateInfo[],
  spindleSettings: { extensionUpdateToastDisabled: {} },
  extensionOperationStatus: null,
  bulkUpdateStatus: null,
  loadExtensions: async () => {},
  enableExtension: async (id: string) => toggle(id, true),
  disableExtension: async (id: string) => toggle(id, false),
  updateExtension: async (id: string) => {
    store.setState(state => ({ extensionUpdates: state.extensionUpdates.filter(update => update.extensionId !== id) }))
  },
  setExtensionOperationStatus: () => {},
}))
function toggle(id: string, enabled: boolean) {
  store.setState(state => ({ extensions: state.extensions.map(extension => extension.id === id ? { ...extension, enabled } : extension) }))
}
function update(extensionId: string): ExtensionUpdateInfo {
  return { extensionId, identifier: extensionId, name: extensionId, currentVersion: '1.0.0', branch: 'main', localCommit: 'old', remoteCommit: 'new' }
}
mock.module('@/store', () => ({ useStore: store }))
mock.module('@/lib/spindle/loader', () => ({
  getExtensionMountPointsVersion: () => 0,
  hasExtensionMountPoint: () => false,
  subscribeExtensionMountPoints: () => () => {},
}))
mock.module('@/components/spindle/SpindleUIControlPanel', () => ({ default: () => null }))
mock.module('./SpindleSettings', () => ({ default: () => null }))

let createRoot: typeof CreateRoot
let SpindlePanel: () => ReactNode
let root: Root | undefined
let container: HTMLDivElement
const i18n = createInstance()

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { panels } }, interpolation: { escapeValue: false } })
  createRoot = (await import('react-dom/client')).createRoot
  SpindlePanel = (await import('./SpindlePanel')).default
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  dom.window.localStorage.clear()
  store.setState({ extensions: fixtures, extensionUpdates: [] })
})
async function renderPanel() {
  dom.window.localStorage.setItem('lumiverse:spindle:extension-panel-preferences', JSON.stringify({ sortMode: 'manual', viewMode: 'list', manualOrder: ['active', 'inactive'] }))
  container = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><SpindlePanel /></I18nextProvider>))
}
function filterButton(filter: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Filter installed extensions"] button')]
    .find(button => button.textContent?.startsWith(filter))!
}
async function click(button: HTMLButtonElement) {
  await act(async () => button.click())
}

test('filter controls select the correct list, retain installed counts, and suspend manual dragging', async () => {
  await renderPanel()
  expect(filterButton('All').getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelectorAll('[title="Disable"], [title="Enable"]')).toHaveLength(2)
  expect(container.querySelectorAll('[aria-label^="Drag "]')).toHaveLength(2)
  await click(filterButton('Active'))
  expect(filterButton('Active').getAttribute('aria-pressed')).toBe('true')
  expect(filterButton('Active').textContent).toBe('Active1')
  expect(container.textContent).toContain('Active Toolkit')
  expect(container.textContent).not.toContain('Inactive Realm')
  expect(container.querySelectorAll('[aria-label^="Drag "]')).toHaveLength(0)
  expect(container.textContent).toContain('Installed (2)')
  await click(filterButton('Inactive'))
  expect(container.textContent).toContain('Inactive Realm')
  expect(container.textContent).not.toContain('Active Toolkit')
  await click(filterButton('All'))
  expect(container.querySelectorAll('[aria-label^="Drag "]')).toHaveLength(2)
})

test('toggling the last active extension updates counts and shows an actionable empty state', async () => {
  await renderPanel()
  await click(filterButton('Active'))
  await click(container.querySelector<HTMLButtonElement>('[title="Disable"]')!)
  expect(filterButton('Active').textContent).toBe('Active0')
  expect(filterButton('Inactive').textContent).toBe('Inactive2')
  expect(container.textContent).toContain('No active extensions.')
  const showAll = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Show all extensions')!
  await click(showAll)
  expect(filterButton('All').getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelectorAll('[title="Enable"]')).toHaveLength(2)
})

test('search combines with activity in card view and Show all clears both controls', async () => {
  await renderPanel()
  await click(container.querySelector<HTMLButtonElement>('[title="Card view"]')!)
  await click(filterButton('Inactive'))
  const search = container.querySelector<HTMLInputElement>('input[type="search"]')!
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
    setValue.call(search, 'Toolkit')
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  expect(container.textContent).toContain('No extensions match this search and filter.')
  const showAll = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Show all extensions')!
  await click(showAll)
  expect(search.value).toBe('')
  expect(filterButton('All').getAttribute('aria-pressed')).toBe('true')
  expect(container.textContent).toContain('Active Toolkit')
  expect(container.textContent).toContain('Inactive Realm')
})

test('Updates includes enabled and disabled extensions and ignores stale or repeated update notices', async () => {
  store.setState({ extensionUpdates: [update('active'), update('inactive'), update('uninstalled'), update('active')] })
  await renderPanel()
  expect(filterButton('Updates').textContent).toBe('Updates2')
  await click(filterButton('Updates'))
  expect(filterButton('Updates').getAttribute('aria-pressed')).toBe('true')
  expect(container.textContent).toContain('Active Toolkit')
  expect(container.textContent).toContain('Inactive Realm')
  expect(container.querySelectorAll('[aria-label^="Drag "]')).toHaveLength(0)
  await click(filterButton('All'))
  expect(container.querySelectorAll('[aria-label^="Drag "]')).toHaveLength(2)
})

test('Updates responds to update-check results and clears after the last update completes', async () => {
  await renderPanel()
  await click(filterButton('Updates'))
  expect(container.textContent).toContain('No extension updates available.')
  await act(async () => store.setState({ extensionUpdates: [update('active')] }))
  expect(filterButton('Updates').textContent).toBe('Updates1')
  expect(container.textContent).toContain('Active Toolkit')
  expect(container.textContent).not.toContain('Inactive Realm')
  await click(container.querySelector<HTMLButtonElement>('[title="Card view"]')!)
  const updateButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Update')!
  await click(updateButton)
  expect(filterButton('Updates').textContent).toBe('Updates0')
  expect(container.textContent).toContain('No extension updates available.')
  expect(filterButton('Updates').getAttribute('aria-pressed')).toBe('true')
})
