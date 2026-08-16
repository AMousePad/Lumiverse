import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, List, LoaderCircle, Pencil } from 'lucide-react'
import { messagesApi } from '@/api/chats'
import { useStore } from '@/store'
import type { ChatFindNavigationTarget } from './ChatFindBar'
import styles from './ScrollToBottom.module.css'

const CHAT_SCROLL_TO_BOTTOM_EVENT = 'lumiverse:chat-scroll-bottom'

interface ChatNavigationControlsProps {
  chatId: string
  onOpenNavigator: () => void
  onNavigate: (target: ChatFindNavigationTarget) => void
}

export default function ScrollToBottom({ chatId, onOpenNavigator, onNavigate }: ChatNavigationControlsProps) {
  const { t } = useTranslation('chat')
  const [showDown, setShowDown] = useState(false)
  const [showUp, setShowUp] = useState(false)
  const [loadingTop, setLoadingTop] = useState(false)
  const messageEditDraft = useStore((state) => state.messageEditDraft)
  const resumeMessageEdit = useStore((state) => state.resumeMessageEdit)
  const totalChatLength = useStore((state) => state.totalChatLength)

  useEffect(() => {
    const list = document.querySelector('[data-chat-scroll="true"]') as HTMLElement | null
    if (!list) return

    const handleScroll = () => {
      const threshold = 300
      const isNearBottom =
        list.scrollHeight - list.scrollTop - list.clientHeight < threshold
      setShowDown(!isNearBottom)
      setShowUp(list.scrollTop > threshold || useStore.getState().messages.length < useStore.getState().totalChatLength)
    }

    const resizeObserver = new ResizeObserver(handleScroll)
    resizeObserver.observe(list)
    list.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()

    return () => {
      resizeObserver.disconnect()
      list.removeEventListener('scroll', handleScroll)
    }
  }, [])

  const scrollDown = useCallback(() => {
    window.dispatchEvent(new Event(CHAT_SCROLL_TO_BOTTOM_EVENT))
  }, [])

  const scrollToTop = useCallback(async () => {
    if (loadingTop) return
    setLoadingTop(true)
    try {
      const page = await messagesApi.list(chatId, { limit: 1, offset: 0 })
      const first = page.data[0]
      if (!first) return
      onNavigate({
        id: first.id,
        index_in_chat: first.index_in_chat,
        offset: 0,
        messageTotal: page.total,
        requestId: Date.now(),
      })
    } catch {
      // Best-effort navigation: the current viewport remains untouched.
    } finally {
      setLoadingTop(false)
    }
  }, [chatId, loadingTop, onNavigate])

  const returnToEdit = useCallback(() => {
    if (!messageEditDraft || messageEditDraft.chatId !== chatId) return
    resumeMessageEdit()
    onNavigate({
      id: messageEditDraft.messageId,
      index_in_chat: messageEditDraft.messageIndexInChat,
      offset: messageEditDraft.messageOffset,
      messageTotal: totalChatLength,
      requestId: Date.now(),
    })
  }, [chatId, messageEditDraft, onNavigate, resumeMessageEdit, totalChatLength])

  const hasDraft = messageEditDraft?.chatId === chatId

  if (!showUp && !showDown && !hasDraft && totalChatLength === 0) return null

  return (
    <div className={styles.controls} data-component="ChatNavigationControls">
      {showUp && (
        <button type="button" className={styles.btn} onClick={() => void scrollToTop()} disabled={loadingTop} aria-label={t('scrollToTop')} title={t('scrollToTop')}>
          {loadingTop ? <LoaderCircle size={17} className={styles.spin} /> : <ArrowUp size={18} />}
        </button>
      )}
      <button type="button" className={styles.btn} onClick={onOpenNavigator} aria-label={t('messageNavigator.open')} title={t('messageNavigator.open')}>
        <List size={17} />
      </button>
      {hasDraft && (
        <button type="button" className={`${styles.btn} ${styles.editBtn}`} onClick={returnToEdit} aria-label={t('messageNavigator.returnToEdit')} title={t('messageNavigator.returnToEdit')}>
          <Pencil size={16} />
        </button>
      )}
      {showDown && (
        <button type="button" className={styles.btn} onClick={scrollDown} aria-label={t('scrollToBottom')} title={t('scrollToBottom')}>
          <ArrowDown size={18} />
        </button>
      )}
    </div>
  )
}
