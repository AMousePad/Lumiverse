import { expect, test } from 'bun:test'
import { commandScopeActive, matchingBinding, type DesktopBinding } from './desktop-keybindings'

const binding: DesktopBinding = { id: 'analyze', scope: 'focused', chord: { code: 'KeyP', ctrl: true, shift: true, alt: false, meta: false } }
const event = { code: 'KeyP', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, isComposing: false }
test('matches physical keys with exactly the configured modifiers', () => {
  expect(matchingBinding([binding], event)).toBe(binding)
  expect(matchingBinding([binding], { ...event, shiftKey: false })).toBeUndefined()
  expect(matchingBinding([binding], { ...event, metaKey: true })).toBeUndefined()
  expect(matchingBinding([binding], { ...event, code: 'KeyQ' })).toBeUndefined()
  expect(matchingBinding([binding], { ...event, isComposing: true })).toBeUndefined()
})
test('identifies native global bindings so the DOM default can be suppressed without another trigger', () => {
  expect(matchingBinding([{ ...binding, scope: 'global' }], event)?.scope).toBe('global')
})
test('key bindings preserve command palette context guards', () => {
  expect(commandScopeActive('chat-idle', '/chat/current', false, 2)).toBe(true)
  expect(commandScopeActive('chat-idle', '/chat/current', true, 2)).toBe(false)
  expect(commandScopeActive('chat-idle', '/', false, 2)).toBe(false)
  expect(commandScopeActive('chat-idle', '/chat/current', false, 0)).toBe(false)
  expect(commandScopeActive('chat', '/chat/current', true, 0)).toBe(true)
  expect(commandScopeActive('character', '/characters/current', false, 0)).toBe(true)
  expect(commandScopeActive('landing', '/characters/current', false, 0)).toBe(false)
})
