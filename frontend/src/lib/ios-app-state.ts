import { hasIOSNativeBridge, iosNativeRequest } from './ios-native'

export type IOSAppState = 'active' | 'inactive' | 'background'

let currentState: IOSAppState | null = null
const listeners = new Set<(state: IOSAppState) => void>()
let stopTracking: (() => void) | null = null

/** UIKit is authoritative when WKWebView leaves visibility or focus stale. */
export function getIOSAppState(): IOSAppState | null {
  return hasIOSNativeBridge() ? currentState : null
}

export function subscribeIOSAppState(onChange: (state: IOSAppState) => void): () => void {
  if (!hasIOSNativeBridge()) return () => {}
  listeners.add(onChange)
  if (!stopTracking) {
    let stopped = false
    let receivedEvent = false
    const publish = (value: unknown) => {
      if (stopped || !value || typeof value !== 'object') return
      const state = (value as { state?: unknown }).state
      if (state !== 'active' && state !== 'inactive' && state !== 'background') return
      currentState = state
      // Do not deduplicate active events: JS may have missed the preceding
      // background event while iOS was suspending the WebView.
      listeners.forEach(listener => listener(state))
    }
    const onState = (event: Event) => {
      receivedEvent = true
      publish((event as CustomEvent<unknown>).detail)
    }
    window.addEventListener('lumiverse:ios-app-state', onState)
    stopTracking = () => {
      stopped = true
      window.removeEventListener('lumiverse:ios-app-state', onState)
      currentState = null
      stopTracking = null
    }
    // Listen first and discard a delayed snapshot after a newer native event.
    // Older wrappers lack this action and retain the browser lifecycle path.
    void iosNativeRequest('lifecycle.status').then(value => {
      if (!receivedEvent) publish(value)
    }).catch(() => {})
  } else if (currentState) {
    onChange(currentState)
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) stopTracking?.()
  }
}
