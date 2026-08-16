/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const chatDir = join(import.meta.dir)

describe('message navigator modal contract', () => {
  test('uses the shared modal shell instead of defining a novel backdrop', () => {
    const component = readFileSync(join(chatDir, 'MessageNavigator.tsx'), 'utf8')
    const css = readFileSync(join(chatDir, 'MessageNavigator.module.css'), 'utf8')

    expect(component).toContain("import { ModalShell } from '@/components/shared/ModalShell'")
    expect(component).toContain('<ModalShell')
    expect(css).not.toContain('backdrop-filter')
    expect(css).not.toContain('.backdrop')
  })
})
