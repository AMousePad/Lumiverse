import { useEffect, useEffectEvent, useCallback, useRef, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import styles from './ModalShell.module.css'
import clsx from 'clsx'
import useIsMobile from '@/hooks/useIsMobile'

interface ModalShellProps {
  isOpen: boolean
  onClose: () => void
  maxWidth?: string | number
  maxHeight?: string | number
  zIndex?: number
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  children: ReactNode
  className?: string
  style?: CSSProperties
  /** Use the available viewport without desktop size caps. */
  fullscreen?: boolean
  /** Short prompts can retain a compact dialog on mobile. Editors fill the window. */
  mobilePresentation?: 'fullscreen' | 'dialog'
  /** Allow a modal body with form controls to scroll when the viewport is short. */
  scrollable?: boolean
  modalId?: string
  /** Stable theme scope for a caller whose content is portalled. */
  'data-component'?: string
}

export function ModalShell({
  isOpen,
  onClose,
  maxWidth = 560,
  maxHeight = 'calc(85dvh / var(--lumiverse-ui-scale, 1))',
  zIndex = 10002,
  closeOnBackdrop = true,
  closeOnEscape = true,
  children,
  className,
  style,
  fullscreen: requestedFullscreen = false,
  mobilePresentation = 'fullscreen',
  scrollable = false,
  modalId = 'shell',
  'data-component': dataComponent,
}: ModalShellProps) {
  const isMobile = useIsMobile()
  const fullscreen = requestedFullscreen || (isMobile && mobilePresentation === 'fullscreen')
  const backdropPointerDownRef = useRef<EventTarget | null>(null)
  const handleEscape = useEffectEvent((e: KeyboardEvent) => {
    if (closeOnEscape && e.key === 'Escape') onClose()
  })

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleEscape)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const handleBackdropPointerDown = useCallback((e: React.PointerEvent) => {
    backdropPointerDownRef.current = e.target === e.currentTarget ? e.currentTarget : null
  }, [])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (
        closeOnBackdrop
        && e.target === e.currentTarget
        && backdropPointerDownRef.current === e.currentTarget
      ) {
        onClose()
      }
    },
    [onClose, closeOnBackdrop],
  )

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className={clsx(styles.backdrop, fullscreen && styles.fullscreenBackdrop)}
          data-modal={dataComponent}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onPointerDown={handleBackdropPointerDown}
          onClick={handleBackdropClick}
          style={{ zIndex }}
        >
          <motion.div
            className={clsx(styles.modal, fullscreen && styles.fullscreenModal, scrollable && styles.scrollable, className)}
            data-component={dataComponent}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            // A caller's viewport-unit limit also needs to fit the available
            // backdrop at larger UI scales and while a keyboard is open.
            style={{
              ...style,
              width: fullscreen ? '100%' : style?.width,
              height: fullscreen ? '100%' : style?.height,
              minWidth: fullscreen ? 0 : style?.minWidth,
              minHeight: fullscreen ? 0 : style?.minHeight,
              maxWidth: fullscreen ? 'none' : isMobile ? '100%' : style?.maxWidth ?? maxWidth,
              maxHeight: fullscreen ? 'none' : style?.maxHeight ?? `min(${typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight}, 100%)`,
            }}
          >
            <span data-spindle-mount="modal_header_actions" data-spindle-scope={`modal:${modalId}:header-actions`} style={{ display: 'contents' }} />
            {children}
            <span data-spindle-mount="modal_footer_actions" data-spindle-scope={`modal:${modalId}:footer-actions`} style={{ display: 'contents' }} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
