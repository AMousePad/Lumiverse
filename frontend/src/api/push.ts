import { get, post, del, type RequestOptions } from './client'

export interface PushSubscriptionRecord {
  type: 'web_push' | 'tauri_desktop' | 'ios_apns'
  id: string
  user_id: string
  endpoint?: string
  device_id?: string
  user_agent: string
  label: string
  platform?: string
  bundle_id?: string
  environment?: 'development' | 'production'
  created_at: number
  updated_at: number
  last_seen_at?: number | null
}

export interface DesktopNotificationEnrollment {
  destination: PushSubscriptionRecord & { type: 'tauri_desktop'; device_id: string }
  credential: string
  serverInstanceId: string
}

export interface PushTestResult {
  success: boolean
  sent: number
  reason?: 'no_subscriptions' | 'disabled' | 'event_disabled' | 'user_active'
}

export const pushApi = {
  getIOSInfo() {
    return get<{ configured: boolean; bundleId: string; reason: string | null }>('/push/ios/info')
  },
  subscribeIOS(input: { deviceId: string; deviceToken: string; bundleId: string; environment: 'development' | 'production' }, options?: RequestOptions) {
    return post<PushSubscriptionRecord>('/push/ios', { ...input, serverOrigin: window.location.origin,
      label: 'Lumiverse iOS', userAgent: navigator.userAgent }, options)
  },
  getVapidPublicKey() {
    return get<{ publicKey: string }>('/push/vapid-public-key')
  },

  getDesktopInfo() {
    return get<{ serverInstanceId: string }>('/push/desktop/info')
  },

  listSubscriptions(options?: RequestOptions) {
    return get<PushSubscriptionRecord[]>('/push/subscriptions', undefined, options)
  },

  subscribe(subscription: PushSubscriptionJSON) {
    return post<PushSubscriptionRecord>('/push/subscriptions', {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      userAgent: navigator.userAgent,
    })
  },

  subscribeDesktop(input: { deviceId: string; label: string; platform: string }) {
    return post<DesktopNotificationEnrollment>('/push/desktop', {
      ...input,
      userAgent: navigator.userAgent,
    })
  },

  unsubscribe(id: string) {
    return del<{ success: boolean }>(`/push/subscriptions/${id}`)
  },

  test(destinationId?: string) {
    return post<PushTestResult>('/push/subscriptions/test', { destinationId })
  },
}
