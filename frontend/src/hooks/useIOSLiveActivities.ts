import { useEffect } from 'react'
import { post, get } from '@/api/client'
import { useStore } from '@/store'
import { hasIOSNativeBridge, iosNativeRequest } from '@/lib/ios-native'
import { getIOSAppState, subscribeIOSAppState } from '@/lib/ios-app-state'
import { getIOSActivityStatus, useIOSLiveActivitiesEnabled, type ActivitySnapshot } from '@/lib/ios-live-activities'

/** Only authoritative, foreground snapshots start activities; persisted chat heads never do. */
export function useIOSLiveActivities(userId: string | null | undefined) {
  const enabled = useIOSLiveActivitiesEnabled()
  useEffect(() => {
    if (!hasIOSNativeBridge() || userId === undefined) return
    let disposed = false, running = false, pending = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const active = () => getIOSAppState() ? getIOSAppState() === 'active' : document.visibilityState !== 'hidden'
    const sync = async () => {
      if (disposed || !userId || !enabled || !active()) return
      if (running) { pending = true; return }
      running = true
      try {
        const native = await getIOSActivityStatus()
        if (disposed || !native.available) return
        const snapshot = await post<{ active: { generationId: string }[]; existing: ActivitySnapshot[] }>(
          '/push/ios/activities/snapshot', { generationIds: native.generationIds.slice(0, 32) })
        if (disposed) return
        await iosNativeRequest('activities.reconcile', { snapshots: snapshot.existing })
        const existing = new Set([...native.generationIds, ...native.suppressedGenerationIds])
        if (!snapshot.active.some(item => !existing.has(item.generationId))) return
        const info = await get<{ configured: boolean; bundleId: string }>('/push/ios/activities/info')
        if (disposed || !info.configured || info.bundleId !== native.bundleId) return
        for (const item of snapshot.active) {
          if (disposed || !active()) break
          if (existing.has(item.generationId)) continue
          const enrollment = await post<Record<string, unknown>>('/push/ios/activities/prepare', {
            generationId: item.generationId, deviceId: native.deviceId, bundleId: native.bundleId,
            environment: native.environment, serverOrigin: window.location.origin,
          })
          if (disposed) break
          await iosNativeRequest('activities.start', enrollment)
        }
      } catch { /* Activity availability must never interrupt generation or ordinary alerts. */ }
      finally {
        running = false
        if (pending && !disposed) { pending = false; schedule() }
      }
    }
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { void sync() }, 100)
    }
    void iosNativeRequest('activities.configure', { accountId: userId, enabled: enabled && !!userId }).then(schedule).catch(() => {})
    const unsubscribeStore = useStore.subscribe((state, previous) => {
      const signature = (heads: typeof state.chatHeads) => heads.map(h => `${h.generationId}:${h.status}`).join('|')
      if (state.chatHeads !== previous.chatHeads && signature(state.chatHeads) !== signature(previous.chatHeads)) schedule()
    })
    const unsubscribeState = subscribeIOSAppState(state => { if (state === 'active') schedule() })
    document.addEventListener('visibilitychange', schedule)
    const interval = setInterval(schedule, 15_000)
    return () => {
      disposed = true
      clearTimeout(timer)
      clearInterval(interval)
      unsubscribeStore()
      unsubscribeState()
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [userId, enabled])
}
