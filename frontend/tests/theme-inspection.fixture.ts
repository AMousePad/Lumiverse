import { createThemeAuthoringAPI } from '../src/lib/spindle/theme-authoring'
import { inspectThemeElements } from '../src/lib/spindle/theme-inspection'

let active = true
let allowed = true
const api = createThemeAuthoringAPI({
  assertActive() { if (!active) throw new Error('Disposed') },
  requireAppManipulation() { if (!allowed) throw new Error('Permission denied') },
  inspect: inspectThemeElements,
} as Parameters<typeof createThemeAuthoringAPI>[0])

Object.assign(window, { themeInspectionFixture: {
  api,
  deny() { allowed = false },
  dispose() { active = false },
} })
