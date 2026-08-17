/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import type { SpindleMountPoint } from 'lumiverse-spindle-types'
import {
  HOST_MOUNT_POINTS,
  isKnownMountPoint,
  type HostMountPoint,
  type WidenedMountPoint,
} from './mount-points'

const AUTHORITATIVE_HOST_MOUNT_POINTS = [
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

const publishedPoint: SpindleMountPoint = 'sidebar'
const hostPoint: WidenedMountPoint = 'landing_main'
const chatSurfaceSidePoint: HostMountPoint = 'chat_surface_side'
const customPoint: WidenedMountPoint = 'third_party_custom_mount'
const widenedPoints: readonly WidenedMountPoint[] = [publishedPoint, hostPoint, chatSurfaceSidePoint, customPoint]

describe('host mount points', () => {
  test('publishes the authoritative catalog in exact order', () => {
    expect(HOST_MOUNT_POINTS).toEqual(AUTHORITATIVE_HOST_MOUNT_POINTS)
  })

  test('accepts every point in the host catalog', () => {
    for (const point of AUTHORITATIVE_HOST_MOUNT_POINTS) {
      expect(isKnownMountPoint(point)).toBe(true)
    }
  })

  test('rejects an unknown point', () => {
    expect(isKnownMountPoint(customPoint)).toBe(false)
  })

  test('supports published, host, and custom widened mount-point values', () => {
    expect(widenedPoints).toEqual([
      'sidebar',
      'landing_main',
      'chat_surface_side',
      'third_party_custom_mount',
    ])
  })

  test('keeps every published host point wired to exactly one frontend anchor', async () => {
    const srcRoot = resolve(import.meta.dir, '../..')
    const glob = new Bun.Glob('**/*.tsx')
    const paths: string[] = []

    for await (const path of glob.scan({ cwd: srcRoot, onlyFiles: true })) {
      if (!path.includes('.test.') && !path.includes('.isolated.')) paths.push(path)
    }

    const source = (await Promise.all(
      paths.map(path => Bun.file(resolve(srcRoot, path)).text()),
    )).join('\n')
    expect(source).toMatch(/data-component="LandingPageCharacterPanel"[\s\S]{0,160}data-spindle-mount="landing_characters"/)
    expect(source).not.toMatch(/data-component="LandingPageChats"[\s\S]{0,160}data-spindle-mount="landing_characters"/)

    for (const point of HOST_MOUNT_POINTS) {
      const matches = source.match(new RegExp(`<[^>]*data-spindle-mount=["']${point}["'][^>]*>`, 'g')) ?? []
      expect(matches, point).toHaveLength(1)
    }
  })
})
