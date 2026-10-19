import { isTauriWebView } from '../../frontend/src/lib/desktopWebView'
import { installNotificationAudioPrimer, playNotificationPing, unlockNotificationAudio } from '../../frontend/src/lib/notificationAudio'
import { installTTSAudioPrimer, speak, stop, unlockTTSAudio } from '../../frontend/src/lib/ttsAudio'
import { audioSmokeFixture } from './audio-fixture'

// A short PCM fixture keeps device verification quiet. It is requested only
// by the test's explicit notification/TTS calls, never as an unlock primer.
async function check() {
  const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
  assert(isTauriWebView(), 'Native host marker is missing')
  assert(!navigator.userActivation?.hasBeenActive, 'Audio must work before the first gesture on this page')
  const OriginalAudio = window.Audio
  const OriginalContext = window.AudioContext
  const elements: HTMLAudioElement[] = []
  const contexts: AudioContext[] = []
  const plays: Promise<void>[] = []
  let dummyBuffers = 0
  let sourceStarts = 0
  window.Audio = new Proxy(OriginalAudio, { construct(target, args) {
    const element = Reflect.construct(target, args) as HTMLAudioElement
    const play = element.play.bind(element)
    element.play = () => { const promise = play(); plays.push(promise); return promise }
    elements.push(element)
    return element
  } })
  window.AudioContext = new Proxy(OriginalContext, { construct(target, args) {
    const context = Reflect.construct(target, args) as AudioContext
    const buffer = context.createBuffer.bind(context)
    context.createBuffer = (...args) => { dummyBuffers++; return buffer(...args) }
    const source = context.createBufferSource.bind(context)
    context.createBufferSource = () => {
      const node = source()
      const start = node.start.bind(node)
      node.start = (...args) => { sourceStarts++; start(...args) }
      return node
    }
    contexts.push(context)
    return context
  } })
  const cleanups = [installNotificationAudioPrimer(), installTTSAudioPrimer()]
  try {
    document.dispatchEvent(new Event('pointerdown'))
    assert(await unlockNotificationAudio(), 'Native notifications unexpectedly require unlocking')
    unlockTTSAudio()
    assert(elements.length === 0 && contexts.length === 0, 'Startup/interaction opened dummy audio')
    playNotificationPing()
    await Promise.all(plays)
    assert(elements.length === 1 && elements[0]!.src.endsWith('/message-received.mp3'), 'Notification did not play the requested file')
    assert(plays.length === 1, 'Notification played an extra unlock file')
    speak(audioSmokeFixture(), 'audio-smoke')
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && (!sourceStarts || !contexts[0] || contexts[0].state !== 'running' || contexts[0].currentTime === 0)) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert(sourceStarts === 1 && dummyBuffers === 0, 'TTS failed or created a dummy buffer')
    assert(contexts[0]?.state === 'running' && contexts[0].currentTime > 0, 'Native AudioContext did not advance without a gesture')
    return { passed: true, noSilentPrimer: true, notificationWithoutGesture: true, ttsWithoutGesture: true }
  } finally {
    cleanups.forEach(cleanup => cleanup())
    stop()
    elements.forEach(element => element.pause())
    await Promise.all(contexts.map(context => context.close()))
    window.Audio = OriginalAudio
    window.AudioContext = OriginalContext
  }
}

void check().catch(error => ({ passed: false, error: String(error) })).then(async result => {
  Object.assign(window, { __lumiverseAudioResult: result })
  const status = document.getElementById('audio')
  if (status) status.textContent = result.passed ? 'Native audio verified' : JSON.stringify(result)
  await fetch('/audio-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(result) })
})
