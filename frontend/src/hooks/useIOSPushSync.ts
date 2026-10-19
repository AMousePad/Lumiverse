import { useEffect } from 'react'
import { pushApi } from '@/api/push'
import { getIOSNotificationStatus, hasIOSNativeBridge, registerIOSPush } from '@/lib/ios-native'
import { getIOSAppState, subscribeIOSAppState } from '@/lib/ios-app-state'

/** Refresh an existing enrollment after APNs rotates its token; never prompt or enroll implicitly. */
export function useIOSPushSync(userId: string | null) {
  useEffect(() => {
    if (!userId || !hasIOSNativeBridge()) return
    let disposed = false, running = false
    const sync = async () => {
      const appState = getIOSAppState()
      if (disposed || running || (appState ? appState !== 'active' : document.visibilityState === 'hidden')) return
      running = true
      try {
        const status = await getIOSNotificationStatus()
        if (!status.available || status.permission !== 'granted' || disposed) return
        const rows = await pushApi.listSubscriptions()
        if (disposed || !rows.some(row => row.type === 'ios_apns' && row.device_id === status.deviceId
          && row.bundle_id === status.bundleId && row.environment === status.environment)) return
        const registration = await registerIOSPush()
        if (!disposed) await pushApi.subscribeIOS(registration)
      } catch { /* Settings shows actionable enrollment errors. Startup remains usable. */ }
      finally { running = false }
    }
    void sync()
    window.addEventListener('lumiverse:ios-push-token', sync)
    document.addEventListener('visibilitychange', sync)
    const unsubscribeAppState = subscribeIOSAppState(state => { if (state === 'active') void sync() })
    return () => {
      disposed = true
      window.removeEventListener('lumiverse:ios-push-token', sync)
      document.removeEventListener('visibilitychange', sync)
      unsubscribeAppState()
    }
  }, [userId])
}
