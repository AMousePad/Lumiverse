import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { JSDOM } from 'jsdom'

mock.module('@/api/client', () => ({ BASE_URL: '/api/v1' }))

let dom: JSDOM
let previous: Record<string, PropertyDescriptor | undefined>
let moduleId = 0
const contexts: FakeContext[] = []
const audioElements: FakeAudio[] = []
const disposers: (() => void)[] = []

class FakeAudio {
  volume = 1
  currentTime = 0
  played: string[] = []
  constructor(public src = '') { audioElements.push(this) }
  play() { this.played.push(this.src); return Promise.resolve() }
}

class FakeContext {
  state = 'suspended'
  sampleRate = 48000
  currentTime = 0
  destination = {}
  silentBuffers = 0
  resumes = 0
  starts = 0
  constructor() { contexts.push(this) }
  createGain() { return { gain: { value: 1 }, connect() {} } }
  createBuffer() { this.silentBuffers++; return { duration: 1 / this.sampleRate } }
  createBufferSource() {
    return { buffer: null, playbackRate: { value: 1 }, onended: null, connect() {},
      start: () => { this.starts++ }, stop() {} }
  }
  decodeAudioData() { return Promise.resolve({ duration: 0.1 }) }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve() }
}

beforeEach(() => {
  dom = new JSDOM('', { url: 'https://lumiverse.example/' })
  previous = Object.fromEntries(['window', 'document', 'Audio', 'AudioContext'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Audio: FakeAudio, AudioContext: FakeContext })
})

afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose())
  dom.window.close()
  for (const [key, descriptor] of Object.entries(previous)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
  contexts.length = 0
  audioElements.length = 0
})

async function modules() {
  // Each document owns its own audio singletons, as it does in the app.
  const notificationPath = `./notificationAudio.ts?document=${++moduleId}`
  const ttsPath = `./ttsAudio.ts?document=${moduleId}`
  const notification = await import(notificationPath) as typeof import('./notificationAudio')
  const tts = await import(ttsPath) as typeof import('./ttsAudio')
  disposers.push(() => tts.stop())
  return { notification, tts }
}

function nativeHost(platform: string) {
  if (platform.endsWith('-init')) {
    Object.assign(window, { __LUMIVERSE_MOBILE__: true, __LUMIVERSE_PLATFORM__: platform.replace('-init', '') })
    return
  }
  if (platform === 'android' || platform === 'ios') document.documentElement.dataset.tauriMobile = platform
  else document.documentElement.dataset.tauriDesktop = ''
  document.documentElement.dataset.platform = platform
}

// At document start the wrappers expose window flags before DOMContentLoaded
// installs the HTML attributes. Audio must skip priming in both phases.
const platforms = ['android', 'ios', 'android-init', 'ios-init', 'macos', 'windows', 'linux']

test.each(platforms)('%s never plays silent unlock audio on startup, touch, or Send', async platform => {
  nativeHost(platform)
  const { notification, tts } = await modules()
  disposers.push(notification.installNotificationAudioPrimer(), tts.installTTSAudioPrimer())
  document.dispatchEvent(new dom.window.Event('pointerdown'))
  document.dispatchEvent(new dom.window.Event('touchstart'))
  document.dispatchEvent(new dom.window.Event('keydown'))
  expect(await notification.unlockNotificationAudio()).toBe(true)
  tts.unlockTTSAudio()
  expect(audioElements).toHaveLength(0)
  expect(contexts).toHaveLength(0)
})

test('primers installed before mobile identification do not play silence once the wrapper is identified', async () => {
  const { notification, tts } = await modules()
  disposers.push(notification.installNotificationAudioPrimer(), tts.installTTSAudioPrimer())
  nativeHost('ios-init')
  document.dispatchEvent(new dom.window.Event('touchstart'))
  await Bun.sleep(0)
  expect(audioElements).toHaveLength(0)
  expect(contexts).toHaveLength(0)
})

test.each(platforms)('%s plays requested notification sounds without a preceding unlock', async platform => {
  nativeHost(platform)
  const { notification } = await modules()
  notification.playNotificationPing()
  notification.playNotificationPing(123)
  expect(audioElements).toHaveLength(1)
  expect(audioElements[0]!.played).toEqual(['/message-received.mp3', '/api/v1/notification-sounds/completion?v=123'])
  expect(contexts).toHaveLength(0)
})

test.each(platforms)('%s lazily starts real TTS and resumes after interruption without a dummy buffer', async platform => {
  nativeHost(platform)
  const { tts } = await modules()
  tts.speak(new ArrayBuffer(4), 'message')
  await Bun.sleep(0)
  expect(contexts).toHaveLength(1)
  expect(contexts[0]!.silentBuffers).toBe(0)
  expect(contexts[0]!.starts).toBe(1)
  expect(contexts[0]!.resumes).toBe(1)
  expect(tts.getActiveMessageId()).toBe('message')
  contexts[0]!.state = 'interrupted'
  tts.speak(new ArrayBuffer(4), 'message')
  await Bun.sleep(0)
  expect(contexts[0]!.starts).toBe(2)
  expect(contexts[0]!.resumes).toBe(2)
  expect(contexts[0]!.silentBuffers).toBe(0)
})

test('browser sessions retain gesture-based primers and only play notifications after unlocking', async () => {
  const { notification, tts } = await modules()
  notification.playNotificationPing()
  expect(audioElements).toHaveLength(0)
  disposers.push(notification.installNotificationAudioPrimer(), tts.installTTSAudioPrimer())
  expect(contexts).toHaveLength(0)
  document.dispatchEvent(new dom.window.Event('pointerdown'))
  await Bun.sleep(0)
  expect(audioElements[0]!.played).toEqual(['/silence.mp3'])
  expect(contexts[0]!.silentBuffers).toBe(1)
  expect(contexts[0]!.starts).toBe(1)
  notification.playNotificationPing()
  document.dispatchEvent(new dom.window.Event('keydown'))
  expect(audioElements[0]!.played).toEqual(['/silence.mp3', '/message-received.mp3'])
  expect(contexts[0]!.silentBuffers).toBe(1)
})
