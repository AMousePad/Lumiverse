import { afterAll, beforeEach, expect, mock, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import { act } from 'react'
import { MemoryRouter } from 'react-router'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import en from '@/i18n/locales/en/auth.json'
import fr from '@/i18n/locales/fr/auth.json'

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/login' })
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  IS_REACT_ACT_ENVIRONMENT: true,
})
window.matchMedia = (media) => ({
  media, matches: false, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  dispatchEvent: () => true,
})
HTMLElement.prototype.scrollIntoView = () => {}

const login = mock(async () => {})
const state = {
  login,
  authError: null,
  isAuthenticated: false,
  isAuthLoading: false,
  checkSession: async () => {},
}
mock.module('@/store', () => ({ useStore: (select: (value: typeof state) => unknown) => select(state) }))
mock.module('@/api/sso-providers', () => ({ ssoProvidersApi: { loginOptions: async () => [] } }))
mock.module('@/lib/ssoPopup', () => ({ startSsoPopup: async () => ({ ok: true }) }))

const { default: LoginPage } = await import('./LoginPage')
const { createRoot } = await import('react-dom/client')
const i18n = createInstance()
await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { auth: en }, fr: { auth: fr } } })

beforeEach(async () => {
  login.mockClear()
  await i18n.changeLanguage('en')
})

afterAll(() => dom.window.close())

async function renderLogin() {
  const container = document.getElementById('root')!
  const testRoot = createRoot(container)
  await act(async () => {
    testRoot.render(<I18nextProvider i18n={i18n}><MemoryRouter><LoginPage /></MemoryRouter></I18nextProvider>)
  })
  return testRoot
}

test('recovery opens and closes without submitting the login form', async () => {
  const testRoot = await renderLogin()
  try {
    const details = document.querySelector('details')!
    const summary = details.querySelector('summary')!
    expect(summary.textContent).toBe('Forgot your password?')
    expect(details.open).toBe(false)
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)

    await act(async () => summary.click())
    expect(details.open).toBe(true)
    expect(details.querySelector('code')!.textContent).toBe('bun run reset-password')
    expect(details.querySelectorAll('li')).toHaveLength(4)
    expect(details.textContent).toContain('machine running Lumiverse')
    expect(details.textContent).toContain('package.json and data/')
    expect(details.textContent).toContain('at least 8 characters')
    expect(details.textContent).toContain('Existing sessions for that account will be signed out')
    expect(details.textContent).toContain('contact your administrator')
    expect(details.textContent).toContain('sign-in provider')
    expect(document.querySelector('input[autocomplete="current-password"]')).not.toBeNull()

    await act(async () => summary.click())
    expect(details.open).toBe(false)
    expect(login).not.toHaveBeenCalled()
  } finally {
    await act(async () => testRoot.unmount())
  }
})

test('recovery instructions fall back to English for untranslated locales', async () => {
  await i18n.changeLanguage('fr')
  const testRoot = await renderLogin()
  try {
    expect(document.querySelector('summary')!.textContent).toBe(en.forgotPassword)
    expect(document.querySelector('details')!.textContent).toContain(en.passwordRecovery.ownerOnly)
    expect(document.querySelector('details')!.textContent).not.toContain('passwordRecovery.')
  } finally {
    await act(async () => testRoot.unmount())
  }
})

test('the displayed command invokes the existing owner reset script', async () => {
  const pkg = await Bun.file(new URL('../../../../package.json', import.meta.url)).json()
  expect(pkg.scripts['reset-password']).toBe('bun run scripts/reset-password.ts')
  expect(await Bun.file(new URL('../../../../scripts/reset-password.ts', import.meta.url)).exists()).toBe(true)
})
