import type { SpindleMountPoint } from 'lumiverse-spindle-types'

/** Host-owned catalog of anchor ids rendered by core. */
export const HOST_MOUNT_POINTS = [
  'sidebar',
  'chat_toolbar',
  'message_footer',
  'settings_extensions',
  'chat_actions',
  'chat_top_dock',
  'chat_column_top',
  'chat_bottom_dock',
  'lorebook_half_workspace',
  'chat_composer_above',
  'chat_surface_side',
  'landing_toolbar',
  'landing_main',
  'landing_chats',
  'landing_characters',
] as const

export type HostMountPoint = (typeof HOST_MOUNT_POINTS)[number]

/** Published points, host-owned points, and third-party anchor ids. */
export type WidenedMountPoint = SpindleMountPoint | HostMountPoint | (string & {})
const knownMountPoints: Readonly<Record<HostMountPoint, true>> = {
  sidebar: true,
  chat_toolbar: true,
  message_footer: true,
  settings_extensions: true,
  chat_actions: true,
  chat_top_dock: true,
  chat_column_top: true,
  chat_bottom_dock: true,
  lorebook_half_workspace: true,
  chat_composer_above: true,
  chat_surface_side: true,
  landing_toolbar: true,
  landing_main: true,
  landing_chats: true,
  landing_characters: true,
}

export function isKnownMountPoint(point: string): point is HostMountPoint {
  return Object.prototype.hasOwnProperty.call(knownMountPoints, point)
}
