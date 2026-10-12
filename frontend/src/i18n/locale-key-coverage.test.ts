import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

const LOCALES_ROOT = join(import.meta.dir, 'locales')
const EN_DIR = join(LOCALES_ROOT, 'en')

/** Drawer tab ids that must have i18n entries (built-in DRAWER_TABS). */
const REQUIRED_DRAWER_TAB_IDS = [
  'profile',
  'presets',
  'loom',
  'weaver',
  'connections',
  'browser',
  'characters',
  'personas',
  'multiplayer',
  'lorebook',
  'cortex',
  'databank',
  'create',
  'prompt',
  'council',
  'summary',
  'worldinfo',
  'imagegen',
  'wallpaper',
  'regex',
  'branches',
  'theme',
  'spindle',
] as const

function leafKeyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : []
  }
  const out: string[] = []
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key
    out.push(...leafKeyPaths(child, next))
  }
  return out
}

function loadJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function enNamespaceFiles(): string[] {
  return readdirSync(EN_DIR).filter((name) => name.endsWith('.json')).sort()
}

function localeDirs(): string[] {
  return readdirSync(LOCALES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function assertLeafKeyParity(enPath: string, otherPath: string, label: string) {
  const enKeys = new Set(leafKeyPaths(loadJson(enPath)))
  const otherKeys = new Set(leafKeyPaths(loadJson(otherPath)))
  const missing = [...enKeys].filter((key) => !otherKeys.has(key))
  const extra = [...otherKeys].filter((key) => !enKeys.has(key))
  expect({ label, missing: missing.slice(0, 15), extra: extra.slice(0, 15) }).toEqual({
    label,
    missing: [],
    extra: [],
  })
  expect(missing).toEqual([])
  expect(extra).toEqual([])
}

describe('i18n locale key coverage', () => {
  const enFiles = enNamespaceFiles()

  test('english locale has the expected namespace files', () => {
    expect(enFiles).toContain('panels.json')
    expect(enFiles).toContain('weaver.json')
    expect(enFiles).toContain('common.json')
  })

  test('de has every en namespace file with identical leaf keys (full German coverage)', () => {
    const deDir = join(LOCALES_ROOT, 'de')
    for (const file of enFiles) {
      const dePath = join(deDir, file)
      expect(existsSync(dePath), `de missing ${file}`).toBe(true)
      assertLeafKeyParity(join(EN_DIR, file), dePath, `de/${file}`)
    }
  })

  test('panels.drawer covers weaver + multiplayer (Party) in every locale', () => {
    for (const lng of localeDirs()) {
      const panelsPath = join(LOCALES_ROOT, lng, 'panels.json')
      expect(existsSync(panelsPath), `${lng}/panels.json`).toBe(true)
      const panels = loadJson(panelsPath) as {
        drawer?: Record<string, unknown>
        multiplayerPanel?: unknown
      }
      expect(panels.drawer, `${lng} panels.drawer`).toBeTruthy()
      for (const tabId of REQUIRED_DRAWER_TAB_IDS) {
        expect(panels.drawer?.[tabId], `${lng} drawer.${tabId}`).toBeTruthy()
      }
      expect(panels.multiplayerPanel, `${lng} multiplayerPanel`).toBeTruthy()
    }
  })
})
