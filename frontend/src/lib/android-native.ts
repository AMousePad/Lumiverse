import { getTauriMobilePlatform } from './desktopWebView'
import { uuidv4 } from './uuid'

interface MessageBridge { postMessage(message: string): void; onmessage?: (event: { data: string }) => void }
const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
let installed: MessageBridge | undefined
export const isNativeAndroid = () => getTauriMobilePlatform() === 'android'
const bridge = () => (window as Window & { lumiverseNotifications?: MessageBridge }).lumiverseNotifications
export const hasAndroidNativeBridge = () => isNativeAndroid() && !!bridge()?.postMessage

export function androidNativeRequest<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const native = bridge()
  if (!hasAndroidNativeBridge() || !native) return Promise.reject(new Error('Update the Lumiverse Android app to enable native notifications.'))
  if (installed !== native) {
    installed = native
    native.onmessage = event => {
      try {
        const reply = JSON.parse(event.data)
        const request = pending.get(reply.id)
        if (!request) return
        clearTimeout(request.timer); pending.delete(reply.id)
        if (reply.error) request.reject(new Error(reply.error)); else request.resolve(reply.result)
      } catch { /* Ignore malformed native replies. */ }
    }
  }
  return new Promise<T>((resolve, reject) => {
    const id = uuidv4()
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Native notification request timed out.')) }, 30_000)
    pending.set(id, { resolve: value => resolve(value as T), reject, timer })
    try { native.postMessage(JSON.stringify({ id, action, payload })) }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error) }
  })
}

export interface AndroidNotificationStatus {
  available: boolean
  permission: NotificationPermission
  deviceId: string
  transport: 'local' | 'fcm'
  projectId: string | null
  reason: string | null
  enrollment: { destinationId: string; serverOrigin: string; serverInstanceId: string; accountId: string } | null
  connected: boolean
}
export interface AndroidPushRegistration { deviceId: string; accountId?: string; transport: 'local' | 'fcm'; deviceToken?: string; projectId?: string }
export const getAndroidNotificationStatus = () => androidNativeRequest<AndroidNotificationStatus>('notifications.status')
export const registerAndroidPush = () => androidNativeRequest<AndroidPushRegistration | null>('notifications.register')
export const clearAndroidEnrollment = (destinationId?: string) => androidNativeRequest('notifications.clear', { destinationId })
