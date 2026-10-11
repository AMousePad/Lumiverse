/**
 * The contract between `ctx.systemAudio` and whatever can actually hear the device's output.
 *
 * Nothing in the web frontend can: a browser only ever hears the microphone, or a tab/screen the user shares each
 * time. A source is a native adapter owned by the desktop client (a separate, separately audited change) that
 * registers itself here. Until one does, `ctx.systemAudio.isAvailable()` says `unsupported` and nothing can start.
 *
 * Sources hand over **analysis only**. Samples never cross this boundary, so there is nothing for the
 * extension-facing layer to leak: it receives a spectrum and levels, rebinned and rate-limited by the host.
 */

export interface SystemAudioSourceFrame {
  /** Overall level, 0 – 1. */
  amplitude: number
  /** Loudest recent level, 0 – 1. */
  peak: number
  /** Log-spaced band magnitudes, 0 – 1, lowest first, any count. The host rebins them for the extension. */
  frequencies: ReadonlyArray<number>
}

/** Why a source stopped by itself. */
export type SystemAudioSourceEndReason = 'source-lost' | 'host-disabled'

export interface SystemAudioSourceHandlers {
  onFrame(frame: SystemAudioSourceFrame): void
  /** The source stopped by itself (device removed, the user switched capture off in the client). */
  onEnd(reason: SystemAudioSourceEndReason): void
}

export interface SystemAudioSourceHandle {
  /** Stop capturing now and release the device. Safe to call repeatedly. */
  stop(): void
}

export type SystemAudioAvailability =
  | { available: true }
  | { available: false; reason: 'unsupported' | 'disabled' }

export interface SystemAudioSource {
  /** Cheap and side-effect free: no prompt, no device access. */
  availability(): SystemAudioAvailability
  /**
   * Begin capture. The user has already approved this start in the host's own prompt, but a native adapter should
   * apply its own OS-level consent too. Rejects if capture cannot start.
   */
  start(handlers: SystemAudioSourceHandlers): Promise<SystemAudioSourceHandle>
}

let registered: SystemAudioSource | null = null

/** For the desktop client's native adapter. Returns a function that unregisters it. */
export function registerSystemAudioSource(source: SystemAudioSource): () => void {
  registered = source
  return () => {
    if (registered === source) registered = null
  }
}

export function getSystemAudioSource(): SystemAudioSource | null {
  return registered
}
