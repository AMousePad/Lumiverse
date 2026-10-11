import { afterEach, beforeAll, expect, mock, test } from 'bun:test'
import { act, createElement } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import shared from '@/i18n/locales/en/shared.json'

const stops: string[] = []
const store = {
  systemAudioSessions: [] as Array<{ id: string; extensionId: string; extensionName: string; stop: () => void }>,
}
mock.module('@/store', () => ({ useStore: (select: (state: typeof store) => unknown) => select(store) }))

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  Node: dom.window.Node, navigator: dom.window.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
})
const i18n = createInstance()
let createRoot: typeof import('react-dom/client').createRoot
let SystemAudioIndicator: typeof import('./SystemAudioIndicator').default
let root: Root | null = null
let host: HTMLDivElement | null = null

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { shared } } })
  ;({ createRoot } = await import('react-dom/client'))
  ;({ default: SystemAudioIndicator } = await import('./SystemAudioIndicator'))
})
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  store.systemAudioSessions = []
  stops.length = 0
})

async function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(I18nextProvider, { i18n }, createElement(SystemAudioIndicator)))
    await Promise.resolve()
  })
}

const indicator = () => document.querySelector('[data-testid="system-audio-indicator"]')

test('shows nothing while no extension is analysing system audio', async () => {
  await render()
  expect(indicator()).toBeNull()
})

test('names every extension that is listening and lets the user stop each one', async () => {
  store.systemAudioSessions = [
    { id: 'a', extensionId: 'ext-a', extensionName: 'Lumi Flair', stop: () => stops.push('a') },
    { id: 'b', extensionId: 'ext-b', extensionName: 'Other Ext', stop: () => stops.push('b') },
  ]
  await render()
  const el = indicator()!
  expect(el.getAttribute('role')).toBe('status')
  expect(el.textContent).toContain('Lumi Flair is analysing system audio')
  expect(el.textContent).toContain('Other Ext is analysing system audio')
  const buttons = [...el.querySelectorAll('button')]
  expect(buttons.map((b) => b.textContent)).toEqual(['Stop', 'Stop'])
  act(() => buttons[1].click())
  expect(stops).toEqual(['b'])
})

test('is rendered outside the app tree, so an extension’s DOM cannot cover or hide it from inside', async () => {
  store.systemAudioSessions = [{ id: 'a', extensionId: 'ext-a', extensionName: 'Lumi Flair', stop: () => {} }]
  await render()
  expect(host!.contains(indicator())).toBe(false)
  expect(indicator()!.parentElement).toBe(document.body)
})
