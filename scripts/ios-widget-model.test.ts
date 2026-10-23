import { expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

test('widget links are collection, account, and enrollment scoped; payloads are bounded', async () => {
  const root = resolve(import.meta.dir, '..'), cache = resolve(root, '.tmp/ios-widget-model-tests')
  mkdirSync(cache, { recursive: true })
  const executable = resolve(cache, 'widget-model')
  const compiler = Bun.spawn(['xcrun', 'swiftc', '-module-cache-path', cache,
    resolve(root, 'ios/native/ios/Sources/CharacterWidgetModel.swift'), resolve(import.meta.dir, 'fixtures/ios-widget-model.swift'), '-o', executable], { stdout: 'pipe', stderr: 'pipe' })
  const errors = await new Response(compiler.stderr).text()
  expect(await compiler.exited, errors).toBe(0)
  const probe = Bun.spawn([executable], { stdout: 'pipe', stderr: 'pipe' })
  expect(await probe.exited, await new Response(probe.stderr).text()).toBe(0)
}, 30_000)
