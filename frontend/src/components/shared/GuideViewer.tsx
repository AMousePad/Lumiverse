import {
  type MouseEvent,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { ArrowLeft, BookOpen } from 'lucide-react'
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

interface ResolvedGuideLink {
  path: string
  hash: string
}

function stripFrontMatter(markdown: string): string {
  return markdown.replace(
    /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/,
    '',
  )
}

function getFrontMatterTitle(markdown: string): string | null {
  const frontMatter = markdown.match(
    /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
  )

  if (!frontMatter) return null

  const title = frontMatter[1].match(/^title:\s*(.+?)\s*$/m)

  if (!title) return null

  return title[1]
    .trim()
    .replace(/^["']|["']$/g, '')
}

function encodeGuidePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function resolveGuideLink(
  basePath: string,
  href: string,
): ResolvedGuideLink {
  const url = new URL(
    href,
    `https://lumiverse.guide/${basePath}`,
  )

  return {
    path: decodeURIComponent(url.pathname.replace(/^\/+/, '')),
    hash: url.hash,
  }
}

function isExternalHref(href: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(href) ||
    href.startsWith('//')
  )
}

function rewriteGuideAssetUrls(
  html: string,
  currentPath: string | null,
): string {
  if (!currentPath || typeof DOMParser === 'undefined') {
    return html
  }

  const document = new DOMParser().parseFromString(
    html,
    'text/html',
  )

  document.querySelectorAll<HTMLImageElement>('img[src]').forEach(
    (image) => {
      const src = image.getAttribute('src')

      if (
        !src ||
        src.startsWith('#') ||
        src.startsWith('/') ||
        isExternalHref(src) ||
        src.startsWith('data:')
      ) {
        return
      }

      const resolved = resolveGuideLink(currentPath, src)

      image.setAttribute(
        'src',
        `/api/v1/docs/${encodeGuidePath(resolved.path)}`,
      )
    },
  )

  return document.body.innerHTML
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

  const [currentPath, setCurrentPath] = useState<string | null>(
    guide.kind === 'builtin'
      ? guide.path
      : null,
  )

  const [history, setHistory] = useState<string[]>([])

  useEffect(() => {
    if (!isOpen) return

    setHistory([])
    setError(null)

    if (guide.kind === 'markdown') {
      setCurrentPath(null)
      setContent(guide.markdown)
      setLoading(false)
      return
    }

    setContent('')
    setCurrentPath(guide.path)
  }, [isOpen, guide])

  useEffect(() => {
    if (
      !isOpen ||
      guide.kind !== 'builtin' ||
      !currentPath
    ) {
      return
    }

    const controller = new AbortController()

    setContent('')
    setError(null)
    setLoading(true)

    void fetch(
      `/api/v1/docs/${encodeGuidePath(currentPath)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Guide request failed (${response.status})`,
          )
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
  }, [isOpen, guide.kind, currentPath])

  const renderedHtml = useMemo(() => {
    if (!content) return ''

    const parsed = marked.parse(
      stripFrontMatter(content),
      { async: false },
    ) as string

    const sanitized = DOMPurify.sanitize(parsed)

    return rewriteGuideAssetUrls(
      sanitized,
      currentPath,
    )
  }, [content, currentPath])

  const documentTitle = useMemo(() => {
    if (guide.kind === 'markdown' && guide.title) {
      return guide.title
    }

    return getFrontMatterTitle(content) ?? title
  }, [content, guide, title])

  const handleBack = () => {
    const previousPath = history.at(-1)

    if (!previousPath) return

    setHistory((current) => current.slice(0, -1))
    setCurrentPath(previousPath)
  }

  const handleContentClick = (
    event: MouseEvent<HTMLDivElement>,
  ) => {
    const target = event.target

    if (!(target instanceof Element)) return

    const anchor = target.closest('a')

    if (
      !anchor ||
      !event.currentTarget.contains(anchor)
    ) {
      return
    }

    const href = anchor.getAttribute('href')

    if (!href) return

    if (href.startsWith('#')) {
      event.preventDefault()

      const id = decodeURIComponent(href.slice(1))

      const heading = event.currentTarget.querySelector(
        `#${CSS.escape(id)}`,
      )

      heading?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })

      return
    }

    if (
      guide.kind !== 'builtin' ||
      !currentPath ||
      isExternalHref(href)
    ) {
      return
    }

    const resolved = resolveGuideLink(currentPath, href)

    if (!/\.md$/i.test(resolved.path)) {
      return
    }

    event.preventDefault()

    setHistory((current) => [
      ...current,
      currentPath,
    ])

    setCurrentPath(resolved.path)
  }

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="min(760px, calc(100vw - 24px))"
      maxHeight="86vh"
      className={styles.modal}
    >
      <div className={styles.header}>
        <div className={styles.headerLeading}>
          {history.length > 0 && (
            <button
              type="button"
              className={styles.backButton}
              onClick={handleBack}
              aria-label="Back to previous guide"
              title="Back"
            >
              <ArrowLeft size={17} strokeWidth={1.7} />
            </button>
          )}

          <div className={styles.headerTitle}>
            <BookOpen size={17} strokeWidth={1.7} />
            <span>{documentTitle}</span>
          </div>
        </div>

        <CloseButton onClick={onClose} />
      </div>

      <div className={styles.body}>
        {loading ? (
          <div className={styles.status}>
            Loading guide…
          </div>
        ) : error ? (
          <div className={styles.error}>
            {error}
          </div>
        ) : (
          <div
            className={styles.prose}
            onClick={handleContentClick}
            dangerouslySetInnerHTML={{
              __html: renderedHtml,
            }}
          />
        )}
      </div>
    </ModalShell>
  )
}