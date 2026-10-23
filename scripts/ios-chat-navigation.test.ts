import { expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

test('native chat taps preserve an open chat and distinguish other destinations and servers', async () => {
  const root = resolve(import.meta.dir, '..')
  const cache = resolve(root, '.tmp/ios-chat-navigation-tests')
  mkdirSync(cache, { recursive: true })
  const executable = resolve(cache, 'navigation-regression')
  const compiler = Bun.spawn(['xcrun', 'swiftc', '-module-cache-path', cache,
    resolve(root, 'ios/native/ios/Sources/NativeServerOrigin.swift'),
    resolve(root, 'ios/native/ios/Sources/NativeChatNavigation.swift'),
    resolve(import.meta.dir, 'fixtures/ios-chat-navigation.swift'), '-o', executable],
    { stdout: 'pipe', stderr: 'pipe' })
  const errors = await new Response(compiler.stderr).text()
  expect(await compiler.exited, errors).toBe(0)
  const probe = Bun.spawn([executable], { stdout: 'pipe', stderr: 'pipe' })
  expect(await probe.exited, await new Response(probe.stderr).text()).toBe(0)
}, 30_000)
