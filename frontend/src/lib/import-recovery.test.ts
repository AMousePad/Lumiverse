import { afterEach, beforeEach, expect, jest, mock, test } from 'bun:test'
import { JSDOM } from 'jsdom'

let user = 'owner'
const getImportStatus = mock()
mock.module('@/store', () => ({ useStore: { getState: () => ({ isAuthenticated: true, user: { id: user } }) } }))
mock.module('@/api/user-data', () => ({ userDataApi: { getImportStatus } }))
const { pendingImportJob, trackImportJob, watchImportJob } = await import('./import-recovery')
let dom: JSDOM
let stop: (() => void) | undefined
let previous: Record<string, unknown>
const refresh = mock(async () => {})
beforeEach(() => {
  dom = new JSDOM('', { url: 'http://localhost/' })
  previous = Object.fromEntries(['window', 'document', 'localStorage'].map(key => [key, Reflect.get(globalThis, key)]))
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage })
  user = 'owner'
  getImportStatus.mockReset()
  refresh.mockReset().mockResolvedValue(undefined)
  jest.useFakeTimers()
})
afterEach(() => {
  stop?.(); stop = undefined
  jest.useRealTimers()
  dom.window.close()
  for (const [key, value] of Object.entries(previous)) Reflect.set(globalThis, key, value)
})
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve() }
async function tick() { jest.advanceTimersByTime(2000); await settle() }

test('recovers completion with the settings panel closed and no WebSocket', async () => {
  getImportStatus.mockResolvedValueOnce({ status: 'running' }).mockResolvedValue({ status: 'complete' })
  trackImportJob(user, 'job')
  stop = watchImportJob(user, refresh)
  await settle()
  expect(refresh).not.toHaveBeenCalled()
  await tick()
  expect(refresh).toHaveBeenCalledWith('job')
  expect(pendingImportJob(user)).toBeNull()
  await tick()
  expect(getImportStatus).toHaveBeenCalledTimes(2)
})

test('retries failed network and refresh attempts, including a foreground wake', async () => {
  getImportStatus.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ status: 'complete' })
  refresh.mockRejectedValueOnce(new Error('settings write failed')).mockResolvedValue(undefined)
  stop = watchImportJob(user, refresh)
  trackImportJob(user, 'job')
  await settle()
  await tick()
  expect(pendingImportJob(user)).toBe('job')
  dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'))
  await settle()
  expect(refresh).toHaveBeenCalledTimes(2)
  expect(pendingImportJob(user)).toBeNull()
})

test('does not apply a late completion to a different signed-in user', async () => {
  let finish!: (value: unknown) => void
  getImportStatus.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  trackImportJob(user, 'job')
  stop = watchImportJob(user, refresh)
  user = 'other'
  finish({ status: 'complete' })
  await settle()
  expect(refresh).not.toHaveBeenCalled()
  expect(pendingImportJob('owner')).toBe('job')
})

test('reloads committed data once when a backend restart loses the job status', async () => {
  getImportStatus.mockRejectedValue({ status: 404 })
  trackImportJob(user, 'job')
  stop = watchImportJob(user, refresh)
  await settle()
  expect(pendingImportJob(user)).toBeNull()
  expect(refresh).toHaveBeenCalledTimes(1)
  await tick()
  expect(getImportStatus).toHaveBeenCalledTimes(1)
})

test('refreshes committed batches after cancellation as well as successful imports', async () => {
  getImportStatus.mockResolvedValue({ status: 'cancelled' })
  trackImportJob(user, 'cancelled-job')
  stop = watchImportJob(user, refresh)
  await settle()
  expect(refresh).toHaveBeenCalledWith('cancelled-job')
})
