import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test'
import { getIOSAppState, subscribeIOSAppState, type IOSAppState } from './ios-app-state'

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
let host: EventTarget & { __LUMIVERSE_MOBILE__: boolean; __LUMIVERSE_PLATFORM__: string; __LUMIVERSE_IOS_NATIVE__: unknown }
let resolveStatus: (value: unknown) => void
let rejectStatus: (reason: Error) => void
let calls: string[]
let cleanups: Array<() => void>

beforeEach(() => {
  calls = []
  cleanups = []
  host = Object.assign(new EventTarget(), {
    __LUMIVERSE_MOBILE__: true, __LUMIVERSE_PLATFORM__: 'ios',
    __LUMIVERSE_IOS_NATIVE__: { version: 1, request(action: string) {
      calls.push(action)
      return new Promise((resolve, reject) => { resolveStatus = resolve; rejectStatus = reject })
    } },
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: host })
})
afterEach(() => { cleanups.forEach(cleanup => cleanup()) })
afterAll(() => {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})
const emit = (state: unknown) => host.dispatchEvent(Object.assign(new Event('lumiverse:ios-app-state'), { detail: { state } }))
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

test('shares the native snapshot and transitions across presence and recovery subscribers', async () => {
  const first: IOSAppState[] = [], second: IOSAppState[] = []
  cleanups.push(subscribeIOSAppState(state => first.push(state)))
  resolveStatus({ state: 'active' })
  await flush()
  cleanups.push(subscribeIOSAppState(state => second.push(state)))
  emit('inactive'); emit('background'); emit('active'); emit('active')
  expect(calls).toEqual(['lifecycle.status'])
  expect(first).toEqual(['active', 'inactive', 'background', 'active', 'active'])
  expect(second).toEqual(first)
  expect(getIOSAppState()).toBe('active')
})

test('ignores a startup snapshot that arrives after a newer native transition', async () => {
  const seen: IOSAppState[] = []
  cleanups.push(subscribeIOSAppState(state => seen.push(state)))
  emit('background')
  resolveStatus({ state: 'active' })
  await flush()
  expect(seen).toEqual(['background'])
  expect(getIOSAppState()).toBe('background')
})

test('stops publishing after cleanup, including a pending snapshot', async () => {
  const seen: IOSAppState[] = []
  const unsubscribe = subscribeIOSAppState(state => seen.push(state))
  emit('active')
  unsubscribe()
  emit('background')
  resolveStatus({ state: 'background' })
  await flush()
  expect(seen).toEqual(['active'])
  expect(getIOSAppState()).toBeNull()
})

test('keeps the browser fallback on wrappers without lifecycle support', async () => {
  const seen: IOSAppState[] = []
  cleanups.push(subscribeIOSAppState(state => seen.push(state)))
  rejectStatus(new Error('Unknown native action.'))
  await flush()
  emit('unknown')
  expect(seen).toEqual([])
  expect(getIOSAppState()).toBeNull()
})

test('does not subscribe or invoke native commands outside the iOS wrapper', () => {
  host.__LUMIVERSE_PLATFORM__ = 'android'
  cleanups.push(subscribeIOSAppState(() => { throw new Error('Unexpected lifecycle event') }))
  emit('active')
  expect(calls).toEqual([])
  expect(getIOSAppState()).toBeNull()
})
