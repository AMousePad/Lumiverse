import { Channel, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  registerSystemAudioSource,
  type SystemAudioAvailability,
  type SystemAudioSource,
  type SystemAudioSourceEndReason,
  type SystemAudioSourceHandlers,
  type SystemAudioSourceStartHints,
} from './system-audio-source'

/**
 * The desktop client's system-audio adapter, as the web layer sees it.
 *
 * Native code (`desktop/src-tauri/src/system_audio`) listens to the output device, does the analysis, and sends back
 * one small message per frame: little-endian `f32`s `[kind, amplitude, peak, band…]`. Nothing else crosses: no samples,
 * no device names. The page only ever asks to start at some frame rate and to stop.
 *
 * Efficiency lives on both sides of the boundary. Native analysis runs only at the frame rate somebody asked for, and
 * only while the window is visible and sound is playing. This side adds no copies: frames are read straight out of the
 * IPC buffer, one native session is shared by every extension that listens, and it ends when the last one leaves.
 */

export interface NativeSystemAudioStatus {
  /** This build can hear the output device at all. */
  supported: boolean
  /** The owner switched the feature on in the tray. */
  enabled: boolean
  active: boolean
}

/** The native surface, injectable so the adapter can be tested without a Tauri runtime. */
export interface NativeSystemAudioBridge {
  status(): Promise<NativeSystemAudioStatus>
  /** Calls `onStatus` whenever the tray switch or session state changes. Resolves to the unsubscribe function. */
  watch(onStatus: (status: NativeSystemAudioStatus) => void): Promise<() => void>
  /** Begin (or replace) the native session; every message from it goes to `onMessage`. */
  start(maxFps: number, onMessage: (data: unknown) => void): Promise<void>
  stop(): Promise<void>
}

const KIND_FRAME = 0
const KIND_SOURCE_LOST = 1
const KIND_HOST_DISABLED = 2
const HEADER_FLOATS = 3

export function createTauriBridge(): NativeSystemAudioBridge {
  return {
    status: () => invoke<NativeSystemAudioStatus>('desktop_system_audio_status'),
    async watch(onStatus) {
      return listen<NativeSystemAudioStatus>('desktop-system-audio-state', ({ payload }) => onStatus(payload))
    },
    async start(maxFps, onMessage) {
      const events = new Channel<unknown>()
      events.onmessage = onMessage
      await invoke('desktop_system_audio_start', { events, maxFps })
    },
    stop: () => invoke('desktop_system_audio_stop'),
  }
}

interface Subscriber {
  handlers: SystemAudioSourceHandlers
  maxFps: number
}

export function createTauriSystemAudioSource(
  bridge: NativeSystemAudioBridge,
  initial: NativeSystemAudioStatus,
) {
  let status = initial
  const subscribers = new Set<Subscriber>()
  /** Frame rate of the native session now running, 0 when none. */
  let runningFps = 0
  /** Bumped whenever a session is replaced or ended, so a message from an old channel is ignored. */
  let generation = 0
  let queue: Promise<void> = Promise.resolve()

  const endAll = (reason: SystemAudioSourceEndReason) => {
    generation++
    runningFps = 0
    const ending = [...subscribers]
    subscribers.clear()
    for (const subscriber of ending) {
      try { subscriber.handlers.onEnd(reason) } catch (error) { console.error('[Spindle] System audio onEnd failed', error) }
    }
  }

  const receive = (own: number) => (data: unknown) => {
    if (own !== generation || !(data instanceof ArrayBuffer) || data.byteLength % 4 !== 0) return
    const values = new Float32Array(data)
    if (values.length < HEADER_FLOATS) return
    switch (values[0]) {
      case KIND_FRAME: {
        // `frequencies` is a view into the IPC buffer: the API copies what it keeps before the next message.
        const frame = { amplitude: values[1], peak: values[2], frequencies: values.subarray(HEADER_FLOATS) }
        for (const subscriber of [...subscribers]) {
          try { subscriber.handlers.onFrame(frame) } catch (error) { console.error('[Spindle] System audio onFrame failed', error) }
        }
        return
      }
      case KIND_SOURCE_LOST: return endAll('source-lost')
      case KIND_HOST_DISABLED: return endAll('host-disabled')
    }
  }

  /** Make the native session match what the subscribers need: none, or one at the fastest rate anyone asked for. */
  const reconcile = async () => {
    const wanted = Math.max(0, ...[...subscribers].map((subscriber) => subscriber.maxFps))
    if (wanted === 0) {
      if (runningFps === 0) return
      generation++
      runningFps = 0
      await bridge.stop()
      return
    }
    if (wanted <= runningFps) return
    // Native `start` replaces the running session, so raising the rate is a plain restart with no gap in consent.
    const own = ++generation
    runningFps = 0
    try {
      await bridge.start(wanted, receive(own))
      if (own === generation) runningFps = wanted
    } catch (error) {
      if (own === generation) endAll('source-lost')
      throw error
    }
  }

  /** One reconcile at a time, so two extensions starting together cannot interleave their native calls. */
  const sync = () => {
    const run = queue.then(reconcile)
    queue = run.catch(() => {})
    return run
  }

  const source: SystemAudioSource = {
    availability(): SystemAudioAvailability {
      if (!status.supported) return { available: false, reason: 'unsupported' }
      return status.enabled ? { available: true } : { available: false, reason: 'disabled' }
    },
    async start(handlers, hints?: SystemAudioSourceStartHints) {
      const subscriber: Subscriber = { handlers, maxFps: Math.min(30, Math.max(1, Math.round(hints?.maxFps ?? 30))) }
      subscribers.add(subscriber)
      try {
        await sync()
      } catch (error) {
        subscribers.delete(subscriber)
        throw error
      }
      return {
        stop() {
          if (subscribers.delete(subscriber)) void sync().catch(() => {})
        },
      }
    },
  }

  return {
    source,
    /** The tray changed the switch or the session state. */
    update(next: NativeSystemAudioStatus) {
      status = next
    },
  }
}

/**
 * Register the adapter if this is the primary desktop frontend and the build can hear the output device. Returns its
 * cleanup. Anywhere else (a browser, a floating widget window, an unsupported OS) nothing is registered, which is what
 * makes `isAvailable()` say `unsupported`.
 */
export async function installTauriSystemAudioSource(
  bridge: NativeSystemAudioBridge = createTauriBridge(),
): Promise<() => void> {
  let initial: NativeSystemAudioStatus
  try {
    initial = await bridge.status()
  } catch {
    return () => {}
  }
  if (!initial?.supported) return () => {}

  const { source, update } = createTauriSystemAudioSource(bridge, initial)
  const unregister = registerSystemAudioSource(source)
  let unwatch: (() => void) | null = null
  let disposed = false
  void bridge
    .watch(update)
    .then((stop) => (disposed ? stop() : (unwatch = stop)))
    .catch((error) => console.warn('[system-audio] Could not watch the native switch', error))
  return () => {
    disposed = true
    unwatch?.()
    unregister()
  }
}
