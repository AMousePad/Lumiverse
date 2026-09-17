import { invoke } from '@tauri-apps/api/core'

export interface DesktopNotificationDeviceState {
  deviceId: string
  enrollment: {
    destinationId: string
    serverInstanceId: string
    serverOrigin: string
  } | null
}

export interface DesktopNotificationEnrollmentInput {
  deviceId: string
  destinationId: string
  credential: string
  serverInstanceId: string
  serverOrigin: string
}

export function isTauriDesktop(): boolean {
  return '__TAURI_INTERNALS__' in window
}

export function getDesktopNotificationDevice(): Promise<DesktopNotificationDeviceState> {
  return invoke('desktop_notification_device')
}

export function getDesktopNotificationPermission(request = false): Promise<NotificationPermission> {
  return invoke<NotificationPermission>('desktop_notification_permission', { request })
}

export function saveDesktopNotificationEnrollment(
  enrollment: DesktopNotificationEnrollmentInput,
): Promise<void> {
  return invoke('save_desktop_notification_enrollment', { enrollment })
}

export function clearDesktopNotificationEnrollment(destinationId?: string): Promise<boolean> {
  return invoke('clear_desktop_notification_enrollment', { destinationId })
}
