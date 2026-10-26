import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { MemoryRouter } from 'react-router'
import type { Message } from '@/types/api'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://lumiverse.test', pretendToBeVisual: true })
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element, Node: dom.window.Node, CustomEvent: dom.window.CustomEvent,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  MutationObserver: class { observe() {} disconnect() {} },
  ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
})
Object.assign(dom.window, {
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
})

const createMessage = mock((_chatId: string, _input: unknown): Promise<Message> => Promise.reject(new Error('backend unavailable')))
const generate = mock((_input: unknown): Promise<{ generationId: string }> => Promise.resolve({ generationId: 'generation-1' }))
const errorToast = mock((_message: string, _options?: { title?: string }) => {})
const sendRoomMessage = mock((): Promise<void> => Promise.resolve())
const state: Record<string, any> = {
  activeChatId: 'a', saveDraftInput: true, activeProfileId: null, activePersonaId: null,
  activeCharacterId: null, activeGroupCharacterId: null, activeChatMetadata: {},
  inputBarEnterToSend: { desktop: true, mobile: true },
  voiceSettings: {}, regenFeedback: {}, councilSettings: { toolsSettings: {} },
  loomRegistry: {}, characterPersonaBindings: {}, personaTagBindings: {},
  expressionDisplay: {}, defaultImpersonationMode: 'standard',
  getActivePresetForGeneration: () => null, setSetting() {},
  setActiveChatMetadata() {}, setActivePersona() {}, setActiveProfile() {},
  beginStreaming: mock(() => {}), startStreaming: mock(() => {}),
  setStreamingError: mock(() => {}), setMentionQueue() {},
  addMessage: mock((message: Message) => { state.messages.push(message) }),
  isMyTurn: () => true,
}
for (const field of ['chatHeads', 'profiles', 'guidedGenerations', 'quickReplySets', 'personas', 'recentPersonaIds', 'messages', 'groupCharacterIds', 'mutedCharacterIds', 'characters', 'extensions']) state[field] = []
const useStore = Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
  getState: () => state, subscribe: () => () => {},
})
let bridge: { text: string; setText(value: string): void; handleSend(): Promise<void> }
mock.module('@/store', () => ({ useStore }))
mock.module('@/api/client', () => ({
  BASE_URL: '/api/v1', ApiError: class extends Error {}, RequestTimeoutError: class extends Error {},
  get: async () => ({}), post: async () => ({}), put: async () => ({}), patch: async () => ({}), del: async () => ({}),
  upload: async () => ({}), uploadRaw: async () => ({}), uploadWithProgress: async () => ({}),
  getBlob: async () => new Blob(), postBlob: async () => new Blob(),
}))
mock.module('@/api/auth', () => ({ authClient: {} }))
mock.module('@/api/chats', () => ({ messagesApi: { create: createMessage }, chatsApi: { get: async () => ({ metadata: {} }) } }))
mock.module('@/api/generate', () => ({ generateApi: { start: generate } }))
mock.module('@/ws/client', () => ({ wsClient: { on: () => () => {}, send() {} } }))
mock.module('@/ws/relayClient', () => ({ sendRoomAction() {} }))
mock.module('@/ws/confirmedRoomMessage', () => ({ sendConfirmedRoomMessage: sendRoomMessage }))
const translate = (key: string) => key
mock.module('react-i18next', () => ({ useTranslation: () => ({ t: translate }), initReactI18next: { type: '3rdParty', init() {} }, Trans: () => null }))
mock.module('@/lib/toast', () => ({ toast: { error: errorToast, info() {}, success() {} } }))
mock.module('@/lib/notificationAudio', () => ({ unlockNotificationAudio() {} }))
mock.module('@/lib/ttsAudio', () => ({ unlockTTSAudio() {} }))
mock.module('@/lib/spindle/use-composer-bridge', () => ({ useComposerBridge: (options: typeof bridge) => { bridge = options } }))
mock.module('@/lib/spindle/use-spindle-component-override', () => ({ useSpindleComponentOverride: (_name: string, component: any, props: any) => createElement(component, props) }))
mock.module('@/hooks/useDeviceFrameRadius', () => ({ useDeviceFrameRadius: () => 0 }))
mock.module('@/hooks/useIsMobile', () => ({ default: () => false }))
mock.module('@/lib/chatAppearance', () => ({ applyChatAppearance: () => () => {} }))
mock.module('@/lib/sttEngine', () => ({ isWebSpeechAvailable: () => false, getSupportedSTTAudioFormat: () => null, createSTTEngine() {} }))
mock.module('@/lib/whistle/client', () => ({ whistleClient: { getState: () => ({}) } }))
mock.module('@/components/quick-toolbar/useQuickToolbarActions', () => ({ useQuickToolbarActions: () => ({ actionById: new Map() }) }))
mock.module('./InputAreaCustomizeModal', () => ({
  default: () => null,
  useComposerActionBar: () => ({ order: [], isVisible: () => false, reorder() {} }),
  fromComposerExtraId: () => null, isComposerActionId: () => false, runComposerSelectMessages() {},
}))
mock.module('./InputAreaComposerBar', () => ({ ComposerActionBarLive: ({ children }: any) => children }))
mock.module('./chatDockerActionCatalog', () => ({ registerChatDockerActionOwners: () => () => {} }))
mock.module('./AuthorsNotePanel', () => ({ default: () => null }))
mock.module('./ReasoningBlock', () => ({ default: () => null }))
mock.module('./InputBarExtensionActions', () => ({ default: () => null }))
mock.module('@/components/shared/PromptVariablesModal', () => ({ PromptVariablesModal: () => null }))
mock.module('./InputArea.module.css', () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }))

const { default: InputArea } = await import('./InputArea')
let root: Root
let host: HTMLDivElement
let consoleError: ReturnType<typeof spyOn>
async function mount(chatId = 'a') {
  state.activeChatId = chatId
  await act(async () => { root.render(<MemoryRouter><InputArea key={chatId} chatId={chatId} /></MemoryRouter>) })
}
async function remount() {
  await act(async () => root.unmount())
  root = createRoot(host)
  await mount()
}
const saved = () => JSON.parse(localStorage.getItem('lumiverse:composerDraft:v1:a') || 'null')
const message = { id: 'message-1', chat_id: 'a', is_user: true, content: 'my work', extra: {} } as Message

beforeEach(async () => {
  consoleError = spyOn(console, 'error').mockImplementation(() => {})
  localStorage.clear()
  state.messages = []
  state.isStreaming = false
  state.mpRoomId = null
  state.saveDraftInput = true
  createMessage.mockReset()
  createMessage.mockImplementation(() => Promise.reject(new Error('backend unavailable')))
  generate.mockReset()
  generate.mockImplementation(() => Promise.resolve({ generationId: 'generation-1' }))
  errorToast.mockClear()
  sendRoomMessage.mockReset()
  state.addMessage.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await mount()
  await act(async () => bridge.setText('my work'))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  consoleError.mockRestore()
})

test('failed sends retain the editable message, persist through refresh, and can be retried', async () => {
  await act(async () => bridge.handleSend())
  expect(bridge.text).toBe('my work')
  expect(saved().text).toBe('my work')
  expect(generate).not.toHaveBeenCalled()
  expect(errorToast).toHaveBeenCalled()
  expect(errorToast.mock.calls.at(-1)?.[1]).toEqual({ title: 'toast.messageDraftKept' })
  await remount()
  expect(bridge.text).toBe('my work')
  createMessage.mockResolvedValue(message)
  await act(async () => bridge.handleSend())
  expect(state.messages).toEqual([message])
  expect(bridge.text).toBe('')
  expect(saved()).toBeNull()
})

test('failed queue requests retain the draft', async () => {
  await act(async () => {
    host.querySelector<HTMLButtonElement>('.sendBtn')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, ctrlKey: true }))
  })
  expect(createMessage).toHaveBeenCalledTimes(1)
  expect(generate).not.toHaveBeenCalled()
  expect(bridge.text).toBe('my work')
  expect(saved().text).toBe('my work')
})

test('uploaded attachments survive a failed send and the following refresh', async () => {
  localStorage.setItem('lumiverse:composerDraft:v1:a', JSON.stringify({
    text: 'my work',
    attachments: [{ type: 'image', image_id: 'upload-1', mime_type: 'image/png', original_filename: 'work.png' }],
  }))
  await remount()
  await act(async () => bridge.handleSend())
  expect(host.querySelector('.attachmentPreview')).not.toBeNull()
  await remount()
  expect(host.querySelector<HTMLImageElement>('.attachmentThumb')?.alt).toBe('work.png')
  createMessage.mockResolvedValue(message)
  await act(async () => bridge.handleSend())
  expect(host.querySelector('.attachmentPreview')).toBeNull()
  expect(saved()).toBeNull()
})

test('a successful queue save clears the submitted draft without generating', async () => {
  createMessage.mockResolvedValue(message)
  await act(async () => {
    host.querySelector<HTMLButtonElement>('.sendBtn')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, ctrlKey: true }))
  })
  expect(state.messages).toEqual([message])
  expect(bridge.text).toBe('')
  expect(saved()).toBeNull()
  expect(generate).not.toHaveBeenCalled()
})

test('failed sends preserve the live input even when draft persistence is disabled', async () => {
  state.saveDraftInput = false
  await mount()
  await act(async () => bridge.handleSend())
  expect(bridge.text).toBe('my work')
  expect(saved()).toBeNull()
})

test('a delayed save keeps the input visible, prevents double sends, and preserves newer edits', async () => {
  const request = Promise.withResolvers<Message>()
  createMessage.mockImplementation(() => request.promise)
  let sending: Promise<void>
  await act(async () => { sending = bridge.handleSend() })
  expect(bridge.text).toBe('my work')
  expect(host.querySelector<HTMLButtonElement>('.sendBtn')!.disabled).toBe(true)
  await act(async () => bridge.handleSend())
  expect(createMessage).toHaveBeenCalledTimes(1)
  await act(async () => bridge.setText('newer work'))
  await act(async () => { request.resolve(message); await sending })
  expect(bridge.text).toBe('newer work')
  expect(saved().text).toBe('newer work')
})

test('a generation failure after saving retains one history message and clears only its draft', async () => {
  createMessage.mockResolvedValue(message)
  generate.mockRejectedValue(new Error('generation unavailable'))
  await act(async () => bridge.handleSend())
  expect(state.messages).toEqual([message])
  expect(bridge.text).toBe('')
  expect(saved()).toBeNull()
  await act(async () => bridge.handleSend())
  expect(createMessage).toHaveBeenCalledTimes(1)
  expect(generate).toHaveBeenCalledTimes(2)
})

test('a late save does not add the old message to another chat or clear its composer', async () => {
  const request = Promise.withResolvers<Message>()
  createMessage.mockImplementation(() => request.promise)
  let sending: Promise<void>
  await act(async () => { sending = bridge.handleSend() })
  await mount('b')
  await act(async () => bridge.setText('chat b work'))
  await act(async () => { request.resolve(message); await sending })
  expect(state.addMessage).not.toHaveBeenCalled()
  expect(bridge.text).toBe('chat b work')
  expect(saved()).toBeNull()
})

test('a room submission failure retains the draft until a later confirmed send', async () => {
  state.mpRoomId = 'room'
  state.mpMyParticipantId = 'peer'
  state.mpIsHost = false
  sendRoomMessage.mockRejectedValue(new Error('unconfirmed'))
  await act(async () => bridge.handleSend())
  expect(bridge.text).toBe('my work')
  expect(saved().text).toBe('my work')
  expect(createMessage).not.toHaveBeenCalled()
  sendRoomMessage.mockResolvedValue()
  await act(async () => bridge.handleSend())
  expect(bridge.text).toBe('')
  expect(saved()).toBeNull()
})
