import { afterEach, beforeEach, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import { subscribeIOSNativeViewport } from './iosNativeViewport'
import { computeViewportKeyboardInset } from './viewportKeyboardInset'

let dom: JSDOM
let previous: Record<string, PropertyDescriptor | undefined>
let resolveStatus: (value: unknown) => void
let stop: (() => void) | undefined

beforeEach(() => {
  dom = new JSDOM('', { url: 'https://lumiverse.example/' })
  previous = Object.fromEntries(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(dom.window, {
    __LUMIVERSE_MOBILE__: true, __LUMIVERSE_PLATFORM__: 'ios',
    __LUMIVERSE_IOS_NATIVE__: { version: 1, request: () => new Promise(resolve => { resolveStatus = resolve }) },
  })
  Object.assign(globalThis, { window: dom.window, document: dom.window.document })
})

afterEach(() => {
  stop?.()
  stop = undefined
  dom.window.close()
  for (const [key, descriptor] of Object.entries(previous)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})

function layout(height: number, revision = 1) {
  return { version: 1, revision, width: 390, height, safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
    divisions: [], occlusions: [] }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
const emit = (height: number, revision: number) => window.dispatchEvent(
  new dom.window.CustomEvent('lumiverse:ios-layout', { detail: layout(height, revision) }),
)
const shellHeight = () => document.documentElement.style.getPropertyValue('--ios-native-viewport-height')

test('uses full native bounds when the closed WebKit viewport excludes the home-indicator area', async () => {
  let fullHeight = 0
  stop = subscribeIOSNativeViewport(height => { fullHeight = height })
  resolveStatus(layout(844))
  await flush()
  expect(shellHeight()).toBe('844px')
  // A 34px safe-area shortfall must not lift the closed composer. When the
  // keyboard opens, clearance must be measured from the complete native frame.
  expect(computeViewportKeyboardInset({ fullHeight, viewportHeight: 810, offsetTop: 0, keyboardActive: false })).toBe(0)
  expect(computeViewportKeyboardInset({ fullHeight, viewportHeight: 510, offsetTop: 0, keyboardActive: true })).toBe(334)
})

test('accepts a smaller scene after rotation or window resizing and ignores stale startup geometry', async () => {
  const heights: number[] = []
  stop = subscribeIOSNativeViewport(height => heights.push(height))
  emit(390, 2)
  resolveStatus(layout(844))
  await flush()
  expect(shellHeight()).toBe('390px')
  emit(320, 3)
  expect(shellHeight()).toBe('320px')
  expect(heights).toEqual([390, 320])
})

test('keeps fallback sizing without the native iOS bridge', () => {
  Object.assign(window, { __LUMIVERSE_PLATFORM__: 'android' })
  stop = subscribeIOSNativeViewport(() => { throw new Error('Unexpected iOS geometry') })
  emit(844, 1)
  expect(shellHeight()).toBe('')
})

test('ignores replies and layout events after disposal', async () => {
  stop = subscribeIOSNativeViewport(() => { throw new Error('Subscription was disposed') })
  stop()
  emit(390, 2)
  resolveStatus(layout(844))
  await flush()
  expect(shellHeight()).toBe('')
})
