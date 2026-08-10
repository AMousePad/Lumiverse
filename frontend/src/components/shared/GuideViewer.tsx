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


function transformAdmonitions(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  const output: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(
      /^!!!\s+([a-zA-Z0-9_-]+)(?:\s+"([^"]*)")?\s*$/,
    )

    if (!match) {
      output.push(lines[i])
      continue
    }

    const [, type, customTitle] = match
    const body: string[] = []

    i += 1

    while (i < lines.length) {
      const line = lines[i]

      if (/^( {4}|\t)/.test(line)) {
        body.push(line.replace(/^( {4}|\t)/, ''))
        i += 1
        continue
      }

      if (line.trim() === '' && body.length > 0) {
        body.push('')
        i += 1
        continue
      }

      break
    }
stripFrontMatter 
    i -= 1

    const title =
  customTitle ||
  type.charAt(0).toUpperCase() + type.slice(1)

const titleHtml = marked.parseInline(
  title,
  { async: false },
) as string

    output.push(
  `<div class="guide-admonition guide-admonition-${type}">`,
  `<div class="guide-admonition-title">${title}</div>`,
  '',
  body.join('\n'),
  '',
  '</div>',
  '',
)
  }

  return output.join('\n')
}

function transformContentTabs(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  const output: string[] = []
  const tabPattern = /^===\s+"([^"]+)"\s*$/

  let i = 0

  while (i < lines.length) {
    const firstMatch = lines[i].match(tabPattern)

    if (!firstMatch) {
      output.push(lines[i])
      i += 1
      continue
    }

    const tabs: Array<{
      label: string
      body: string
    }> = []

    while (i < lines.length) {
      const headerMatch = lines[i].match(tabPattern)

      if (!headerMatch) break

      const label = headerMatch[1]

      i += 1

      // Zensical normally leaves a blank line after === "Label".
      if (i < lines.length && lines[i].trim() === '') {
        i += 1
      }

      const bodyLines: string[] = []

      while (i < lines.length) {
        const line = lines[i]

        // Next sibling tab starts here.
        if (tabPattern.test(line)) {
          break
        }

        // Blank lines belong to the current tab body.
        if (line.trim() === '') {
          bodyLines.push('')
          i += 1
          continue
        }

        // Tab contents are indented one Markdown level.
        if (/^( {4}|\t)/.test(line)) {
          bodyLines.push(
            line.replace(/^( {4}|\t)/, ''),
          )
          i += 1
          continue
        }

        // Non-indented content means the tab group is over.
        break
      }

      tabs.push({
        label,
        body: bodyLines.join('\n').trimEnd(),
      })

      if (
        i >= lines.length ||
        !tabPattern.test(lines[i])
      ) {
        break
      }
    }

    const buttons = tabs
      .map((tab, index) => {
        const labelHtml = marked.parseInline(
          tab.label,
          { async: false },
        ) as string

        return `
<button
  type="button"
  class="guide-content-tab"
  data-guide-tab-button="${index}"
  aria-selected="${index === 0 ? 'true' : 'false'}"
>
  ${labelHtml}
</button>`
      })
      .join('')

    const panels = tabs
      .map((tab, index) => {
        /*
         * The tab body has now been dedented by four spaces.
         * This turns nested constructs like:
         *
         *     !!! warning
         *         body
         *
         * into normal top-level admonition syntax for our
         * existing transformer.
         */
        const bodyHtml = marked.parse(
          transformAdmonitions(tab.body),
          { async: false },
        ) as string

        return `
<div
  class="guide-content-tab-panel"
  data-guide-tab-panel="${index}"
  data-active="${index === 0 ? 'true' : 'false'}"
>
  ${bodyHtml}
</div>`
      })
      .join('')

    output.push(
      '',
      '<div class="guide-content-tabs" data-guide-tab-group>',
      `<div class="guide-content-tab-list">${buttons}</div>`,
      `<div class="guide-content-tab-panels">${panels}</div>`,
      '</div>',
      '',
    )
  }

  return output.join('\n')
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

function encodeDocumentKey(path: string): string {
  const bytes = new TextEncoder().encode(path)

  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function documentUrl(path: string): string {
  return `/api/v1/docs/file/${encodeDocumentKey(path)}`
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
  documentUrl(resolved.path),
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

  const guideUrl = documentUrl(currentPath)

  void fetch(
    guideUrl,
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

      const message =
        err instanceof Error
          ? err.message
          : 'Unable to load this guide.'

      setError(message)
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

    const preparedMarkdown = transformContentTabs(
  stripFrontMatter(content),
)

const parsed = marked.parse(
  transformAdmonitions(preparedMarkdown),
  { async: false },
) as string

    const sanitized = DOMPurify.sanitize(parsed)

    return rewriteGuideAssetUrls(
      sanitized,
      currentPath,
    )
  }, [content, currentPath])

  const documentTitle = useMemo(() => {
    if (guide.title) {
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