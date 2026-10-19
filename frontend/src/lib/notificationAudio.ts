/**
 * Singleton Audio element for playing notification pings when a
 * backgrounded chat finishes generating.
 *
 * Mobile Safari locks audio per-element, so we reuse one element and
 * swap its `src` rather than creating new Audio() each time.
 *
 * Browser sessions call `unlockNotificationAudio()` during a user gesture.
 * Native WebViews allow playback directly without a silent unlock file.
 */

import { BASE_URL } from '@/api/client'
import { isTauriWebView } from '@/lib/desktopWebView'

const SILENCE_SRC = '/silence.mp3'
const DEFAULT_PING_SRC = '/message-received.mp3'
const CUSTOM_PING_PATH = `${BASE_URL}/notification-sounds/completion`

let audio: HTMLAudioElement | null = null
let unlocked = false
let unlockPromise: Promise<boolean> | null = null

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = isTauriWebView() ? new Audio() : new Audio(SILENCE_SRC)
    audio.volume = 0.5
  }
  return audio
}

/** Play silence during a user gesture to unlock the element for later programmatic playback. */
export function unlockNotificationAudio(): Promise<boolean> {
  // Our native WebViews allow playback without a gesture. Do not load or
  // play a dummy media file just because the user touched the app.
  if (isTauriWebView()) return Promise.resolve(true)
  if (unlocked) return Promise.resolve(true)
  if (unlockPromise) return unlockPromise
  const el = getAudio()
  el.src = SILENCE_SRC
  unlockPromise = el.play().then(() => {
    unlocked = true
    return true
  }).catch(() => {
    // Browser still blocking — will retry on next gesture
    return false
  }).finally(() => {
    unlockPromise = null
  })
  return unlockPromise
}

/**
 * Register one-time document-level listeners that unlock notification audio on
 * the first interaction anywhere in the app. This covers users who interact
 * with navigation, modals, drawers, extensions, or keyboard shortcuts before a
 * background chat finishes, instead of requiring a direct Send-button click.
 */
export function installNotificationAudioPrimer(): () => void {
  if (typeof document === 'undefined' || isTauriWebView()) return () => {}

  const events: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'touchstart']
  let disposed = false

  const handler = () => {
    if (disposed) return
    void unlockNotificationAudio().then((ok) => {
      if (ok) dispose()
    })
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const e of events) document.removeEventListener(e, handler, true)
  }

  // Capture phase covers portals/extensions that stop propagation. Passive
  // keeps the primer from blocking touch scrolling.
  for (const e of events) {
    document.addEventListener(e, handler, { capture: true, passive: true })
  }

  return dispose
}

/**
 * Play the notification ping. Browser sessions must first unlock the element.
 *
 * Pass `customSoundVersion` (e.g. the user's `uploadedAt` unix-seconds
 * timestamp) to route playback through the user-uploaded sound at
 * `/api/v1/notification-sounds/completion`. The version is appended as a
 * query string so a re-upload busts the browser's audio cache.
 */
export function playNotificationPing(customSoundVersion?: number | null): void {
  if (!unlocked && !isTauriWebView()) return
  const el = getAudio()
  const nextSrc = customSoundVersion
    ? `${CUSTOM_PING_PATH}?v=${customSoundVersion}`
    : DEFAULT_PING_SRC
  el.src = nextSrc
  el.currentTime = 0
  el.play().catch(() => {
    // Swallow — user may have revoked audio permission
  })
}
