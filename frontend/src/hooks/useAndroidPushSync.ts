import { useEffect } from 'react'
import { pushApi } from '@/api/push'
import { androidNativeRequest, clearAndroidEnrollment, getAndroidNotificationStatus, hasAndroidNativeBridge, registerAndroidPush } from '@/lib/android-native'

/** Reconcile existing opt-in on startup, account changes, token rotation and native resume. */
export function useAndroidPushSync(accountId: string | null | undefined) {
  useEffect(() => {
    if (accountId === undefined || !hasAndroidNativeBridge()) return
    const abort = new AbortController()
    let running = false
    const sync = async () => {
      if (running || abort.signal.aborted) return
      running = true
      try {
        await androidNativeRequest('notifications.account', { accountId })
        if (!accountId) return
        const [status, rows, info] = await Promise.all([getAndroidNotificationStatus(), pushApi.listSubscriptions({ signal: abort.signal }), pushApi.getAndroidInfo()])
        if (abort.signal.aborted) return
        const current = rows.find(row => row.type === 'android_native' && row.device_id === status.deviceId)
        if (!current) { if (status.enrollment) await clearAndroidEnrollment(status.enrollment.destinationId); return }
        if (status.permission !== 'granted' || !status.available || (status.transport === 'fcm' && (!info.configured || info.projectId !== status.projectId))) return
        const registration = await registerAndroidPush()
        if (!registration || abort.signal.aborted) return
        const fresh = await androidNativeRequest<boolean>('notifications.current', { ...registration, destinationId: current.id, serverInstanceId: info.serverInstanceId })
        if (fresh || abort.signal.aborted) return
        const enrollment = await pushApi.subscribeAndroid(registration, { signal: abort.signal })
        if (!abort.signal.aborted) await androidNativeRequest('notifications.save', { ...enrollment, deviceToken: registration.deviceToken, accountId, serverOrigin: window.location.origin })
      } catch { /* Retry at next resume; no implicit permission prompts. */ }
      finally { running = false }
    }
    void sync()
    window.addEventListener('lumiverse:android-resume', sync)
    window.addEventListener('lumiverse:android-push-token', sync)
    return () => { abort.abort(); window.removeEventListener('lumiverse:android-resume', sync); window.removeEventListener('lumiverse:android-push-token', sync) }
  }, [accountId])
}
