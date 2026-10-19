import { afterAll, afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, createElement, type ComponentType } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { build } from 'vite'
import { createReactCompilerPlugins } from './react-compiler'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
})
const temporaryRoot = resolve(import.meta.dirname, '../.tmp')
mkdirSync(temporaryRoot, { recursive: true })
const fixture = mkdtempSync(join(temporaryRoot, 'react-compiler-test-'))
const entry = join(fixture, 'entry.tsx')
writeFileSync(entry, `
import { useEffect, useEffectEvent, useState } from 'react'
import { ActivityPanel } from '../../src/components/shared/ActivityPanel'
export const events = []
function Panel({ label }) {
  'use memo'
  const [count, setCount] = useState(0)
  const receive = useEffectEvent(() => events.push('event:' + label))
  useEffect(() => {
    events.push('start')
    window.addEventListener('compiler-probe', receive)
    return () => {
      events.push('stop')
      window.removeEventListener('compiler-probe', receive)
    }
  }, [])
  return <section><button onClick={() => setCount(count + 1)}>{count}</button><textarea defaultValue="draft" /></section>
}
export function Probe({ active, label }) {
  return <ActivityPanel active={active}><Panel label={label} /></ActivityPanel>
}
`)
let root: Root | undefined
let host: HTMLDivElement | undefined
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  host?.remove()
})
afterAll(() => {
  dom.window.close()
  rmSync(fixture, { recursive: true, force: true })
})

for (const mode of ['babel', 'native']) {
  test(`${mode} production output preserves Effect Events and Activity lifecycle`, async () => {
    const result = await build({
      configFile: false,
      plugins: createReactCompilerPlugins(mode),
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        lib: { entry, formats: ['es'] },
        rolldownOptions: {
          external: (id) => id === 'react' || id.startsWith('react/'),
          output: { codeSplitting: false },
        },
      },
    })
    const builds = Array.isArray(result) ? result : [result]
    const chunk = builds.flatMap((item) => 'output' in item ? item.output : [])
      .find((item) => item.type === 'chunk')
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing compiled fixture')
    // This proves that annotation mode actually compiled the fixture, rather
    // than passing a runtime test after silently skipping the compiler.
    expect(chunk.code).toContain('react/compiler-runtime')
    const output = join(fixture, `${mode}.mjs`)
    writeFileSync(output, chunk.code)
    const { Probe, events } = await import(pathToFileURL(output).href) as {
      Probe: ComponentType<{ active: boolean; label: string }>
      events: string[]
    }
    host = document.createElement('div')
    document.body.append(host)
    root = (await import('react-dom/client')).createRoot(host)
    const show = (active: boolean, label: string) => act(async () => root!.render(createElement(Probe, { active, label })))
    const signal = () => window.dispatchEvent(new dom.window.Event('compiler-probe'))

    await show(true, 'first')
    act(() => host!.querySelector('button')!.click())
    const draft = host.querySelector('textarea')!
    draft.value = 'retained draft'
    await show(true, 'latest')
    signal()
    expect(events).toEqual(['start', 'event:latest'])
    await show(false, 'hidden')
    signal()
    expect(events).toEqual(['start', 'event:latest', 'stop'])
    await show(true, 'restored')
    expect(host.querySelector('button')!.textContent).toBe('1')
    expect(host.querySelector('textarea') === draft).toBe(true)
    expect(draft.value).toBe('retained draft')
    signal()
    expect(events).toEqual(['start', 'event:latest', 'stop', 'start', 'event:restored'])
    await act(async () => root!.unmount())
    root = undefined
    signal()
    expect(events.at(-1)).toBe('stop')
  }, 30_000)
}
