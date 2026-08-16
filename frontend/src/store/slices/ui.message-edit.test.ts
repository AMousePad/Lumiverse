/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { createStore } from 'zustand/vanilla'
import { createUISlice } from './ui'
import type { UISlice } from '@/types/store'

function createUIStore() {
  return createStore<UISlice>()(createUISlice)
}

const draft = {
  chatId: 'chat-1',
  messageId: 'message-20',
  messageOffset: 19,
  messageIndexInChat: 20,
  content: 'original',
  reasoning: '',
  showReasoningEditor: false,
  hadReasoning: false,
}

describe('message edit draft lifecycle', () => {
  test('keeps draft content when an editor is deactivated and resumed', () => {
    const store = createUIStore()

    store.getState().beginMessageEdit(draft)
    store.getState().updateMessageEditDraft({ content: 'unsaved change' })
    store.getState().setEditingMessageId(null)

    expect(store.getState().editingMessageId).toBeNull()
    expect(store.getState().messageEditDraft?.content).toBe('unsaved change')
    expect(store.getState().messageEditDraft?.dirty).toBe(true)

    store.getState().resumeMessageEdit()
    expect(store.getState().editingMessageId).toBe(draft.messageId)
    expect(store.getState().messageEditDraft?.focusRequested).toBe(true)
  })

  test('consumes remount focus separately from clearing the draft', () => {
    const store = createUIStore()

    store.getState().beginMessageEdit(draft)
    store.getState().consumeMessageEditFocusRequest()

    expect(store.getState().messageEditDraft?.focusRequested).toBe(false)
    expect(store.getState().messageEditDraft?.content).toBe('original')

    store.getState().clearMessageEdit()
    expect(store.getState().editingMessageId).toBeNull()
    expect(store.getState().messageEditDraft).toBeNull()
  })
})
