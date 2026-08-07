/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  forgetExtensionIdentity,
  registerExtensionIdentity,
  stampExtensionRoot,
} from './extension-root-stamp'

const extensionId = '00000000-0000-0000-0000-000000000001'

describe('extension root stamping', () => {
  test('writes UUID ownership and identifier metadata without making metadata authoritative', () => {
    const root = document.createElement('section')
    registerExtensionIdentity(extensionId, 'lumiverse_suite')
    stampExtensionRoot(root, extensionId, 'data-spindle-extension-id')

    expect(root.getAttribute('data-spindle-extension-id')).toBe(extensionId)
    expect(root.getAttribute('data-spindle-ext-id')).toBe('lumiverse_suite')

    forgetExtensionIdentity(extensionId)
    const unloadedRoot = document.createElement('section')
    stampExtensionRoot(unloadedRoot, extensionId, 'data-spindle-ext')
    expect(unloadedRoot.getAttribute('data-spindle-ext')).toBe(extensionId)
    expect(unloadedRoot.getAttribute('data-spindle-ext-id')).toBeNull()
  })

  test('keeps reserved root attributes behind stampExtensionRoot', async () => {
    const productionFiles = [
      'dom-helper.ts',
      'dom-injection-registry.ts',
      'loader.ts',
      'message-widgets.tsx',
      'placement-helper.ts',
      'sandbox-frame.ts',
    ]
    const source = await Promise.all(
      productionFiles.map((file) => readFile(resolve(import.meta.dir, file), 'utf8')),
    )
    const directWriter = /\.setAttribute\(\s*['"]data-spindle-(?:ext|extension-root|extension-id)['"]\s*,/g
    for (const [index, text] of source.entries()) {
      expect(text.match(directWriter), productionFiles[index]).toBeNull()
    }
  })
})
