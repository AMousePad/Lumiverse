import { useEffect, useMemo, useState } from 'react'
import { BookOpen } from 'lucide-react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

import { ModalShell } from '@/components/shared/ModalShell'
import { CloseButton } from '@/components/shared/CloseButton'
import type { DrawerGuide } from '@/lib/drawer-tab-registry'

import styles from './GuideViewer.module.css'

interface GuideViewerProps {
  isOpen: boolean
  onClose: () => void
  guide: DrawerGuide
  title: string
}

function stripFrontMatter(markdown: string): string {
  return markdown.replace(
    /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/,
    '',
  )
}

function encodeGuidePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

export function GuideViewer({
  isOpen,
  onClose,
  guide,
  title,
}: GuideViewerProps) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return

    setError(null)

    if (guide.kind === 'markdown') {
      setContent(guide.markdown)
      setLoading(false)
      return
    }

    const controller = new AbortController()

    setContent('')
    setLoading(true)

    void fetch(
      `/api/v1/docs/${encodeGuidePath(guide.path)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Guide request failed (${response.status})`)
        }

        return response.text()
      })
      .then((text) => {
        setContent(text)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return

        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load this guide.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => {
      controller.abort()
    }
  }, [isOpen, guide])

  const renderedHtml = useMemo(() => {
    if (!content) return ''

    const parsed = marked.parse(
      stripFrontMatter(content),
      { async: false },
    ) as string

    return DOMPurify.sanitize(parsed)
  }, [content])

  const resolvedTitle =
    guide.kind === 'markdown' && guide.title
      ? guide.title
      : title

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="min(760px, calc(100vw - 24px))"
      maxHeight="86vh"
      className={styles.modal}
    >
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <BookOpen size={17} strokeWidth={1.7} />
          <span>{resolvedTitle}</span>
        </div>

        <CloseButton onClick={onClose} />
      </div>

      <div className={styles.body}>
        {loading ? (
          <div className={styles.status}>Loading guide…</div>
        ) : error ? (
          <div className={styles.error}>{error}</div>
        ) : (
          <div
            className={styles.prose}
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        )}
      </div>
    </ModalShell>
  )
}