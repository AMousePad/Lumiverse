import { useRef, useCallback, useState, useEffect, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useScrollGate } from '@/hooks/useScrollGate'
import { getCharacterAvatarLargeUrl, getCharacterAvatarThumbUrl } from '@/lib/avatarUrls'
import { prefetchImages } from '@/lib/imageDecodeCache'
import { measureLayoutHeight } from '@/lib/uiScale'
import { readLayoutVar } from '@/lib/layoutVars'
import CharacterCard from './CharacterCard'
import type { Character, CharacterSummary } from '@/types/api'
import styles from './CharacterGrid.module.css'

interface CharacterGridProps {
  characters: (Character | CharacterSummary)[]
  favorites: string[]
  batchMode: boolean
  batchSelected: string[]
  singleColumn?: boolean
  onOpen: (character: Character | CharacterSummary) => void
  onEdit: (id: string) => void
  onToggleFavorite: (id: string) => void
  onToggleBatch: (id: string) => void
}

const MIN_COL_WIDTH = 200
const MIN_CARD_WIDTH = 140 // narrowest card that still reads well on a phone
const GAP = 20
const MOBILE_BREAKPOINT = 600
const MOBILE_GAP = 12
const MOBILE_MAX_COLUMNS = 2
const PREFETCH_ROWS = 6

function getGap(width: number, desktopGap = GAP): number {
  return width <= MOBILE_BREAKPOINT ? MOBILE_GAP : desktopGap
}

function getColumnCount(width: number, desktopMinWidth = MIN_COL_WIDTH, desktopGap = GAP): number {
  if (width <= 0) return 1
  const mobile = width <= MOBILE_BREAKPOINT
  const minWidth = mobile ? MIN_CARD_WIDTH : desktopMinWidth
  const gap = mobile ? MOBILE_GAP : desktopGap
  // The row has horizontal padding totalling `gap`, so the cards and the
  // gaps between them must fit inside `width - gap`.
  const cols = Math.max(1, Math.floor(width / (minWidth + gap)))
  return mobile ? Math.min(MOBILE_MAX_COLUMNS, cols) : cols
}

export default function CharacterGrid({
  characters,
  favorites,
  batchMode,
  batchSelected,
  singleColumn,
  onOpen,
  onEdit,
  onToggleFavorite,
  onToggleBatch,
}: CharacterGridProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const geometryProbeRef = useRef<HTMLDivElement>(null)
  useScrollGate(parentRef)
  const [columns, setColumns] = useState(singleColumn ? 1 : 2)
  const [containerWidth, setContainerWidth] = useState(400)
  const [layoutMetrics, setLayoutMetrics] = useState({
    minWidth: MIN_COL_WIDTH,
    gap: GAP,
    height: 0,
  })

  // O(1) lookups instead of O(n) includes() per card
  const favSet = useMemo(() => new Set(favorites), [favorites])
  const batchSet = useMemo(() => new Set(batchSelected), [batchSelected])

  // Observe container and probe geometry so CSS variable changes trigger a
  // fresh layout calculation even when the container itself does not resize.
  useEffect(() => {
    const el = parentRef.current
    if (!el) return

    const syncLayout = (entries: ResizeObserverEntry[] = []) => {
      const containerEntry = entries.find((entry) => entry.target === el)
      const measuredWidth = containerEntry?.contentRect.width ?? el.clientWidth
      const width = Number.isFinite(measuredWidth) && measuredWidth >= 0 ? measuredWidth : 0
      const layoutElement = geometryProbeRef.current ?? el
      const rawMinWidth = readLayoutVar(layoutElement, '--character-card-min-width', MIN_COL_WIDTH)
      const minWidth = Number.isFinite(rawMinWidth) && rawMinWidth > 0 ? rawMinWidth : MIN_COL_WIDTH
      const rawGap = readLayoutVar(layoutElement, '--character-card-gap', GAP)
      const gap = Number.isFinite(rawGap) && rawGap > 0 ? rawGap : GAP
      const rawHeight = readLayoutVar(layoutElement, '--character-card-height', 0)
      const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 0

      setContainerWidth((current) => (current === width ? current : width))
      setLayoutMetrics((current) => {
        if (current.minWidth === minWidth && current.gap === gap && current.height === height) {
          return current
        }
        return { minWidth, gap, height }
      })

      const nextColumns = singleColumn ? 1 : getColumnCount(width, minWidth, gap)
      setColumns((current) => (current === nextColumns ? current : nextColumns))
    }

    syncLayout()
    const observer = new ResizeObserver(syncLayout)
    observer.observe(el)
    const geometryProbe = geometryProbeRef.current
    if (geometryProbe) observer.observe(geometryProbe)
    return () => observer.disconnect()
  }, [singleColumn])

  // Compute row height from actual column width: card is 3:4 aspect (matching
  // landing page cards). Info section overlays the image bottom, so no extra
  // height is added when no desktop card-height variable is published.
  const gap = getGap(containerWidth, layoutMetrics.gap)
  const colWidth = Math.max(1, (containerWidth - gap * columns) / columns)
  const rowHeight =
    containerWidth > MOBILE_BREAKPOINT && layoutMetrics.height > 0
      ? layoutMetrics.height + gap
      : Math.ceil(colWidth * (4 / 3)) + gap
  const rowCount = Math.ceil(characters.length / columns)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 5,
    measureElement: (el) => measureLayoutHeight(el),
    paddingStart: gap,
  })

  // When the responsive layout changes, force the virtualizer to re-measure
  // row heights so absolute positions stay in sync with the actual DOM.
  useEffect(() => {
    virtualizer.measure()
  }, [virtualizer, rowHeight, columns])

  const getCharacter = useCallback(
    (rowIndex: number, colIndex: number): Character | CharacterSummary | undefined => {
      const index = rowIndex * columns + colIndex
      return characters[index]
    },
    [characters, columns]
  )

  // Prefetch avatar images for rows near the visible viewport so they're
  // already decoded when the virtualizer scrolls them into view.
  const virtualItems = virtualizer.getVirtualItems()
  const visStart = virtualItems.length > 0 ? virtualItems[0].index : -1
  const visEnd = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1
  useEffect(() => {
    if (visStart < 0 || characters.length === 0) return
    const startRow = Math.max(0, visStart - PREFETCH_ROWS)
    const endRow = Math.min(rowCount - 1, visEnd + PREFETCH_ROWS)
    const startIdx = startRow * columns
    const endIdx = Math.min(characters.length, (endRow + 1) * columns)
    const urls: string[] = []
    for (let i = startIdx; i < endIdx; i++) {
      const char = characters[i]
      if (!char) continue
      const url = getCharacterAvatarLargeUrl(char) ?? getCharacterAvatarThumbUrl(char)
      if (url) urls.push(url)
    }
    if (urls.length > 0) prefetchImages(urls)
  }, [visStart, visEnd, characters, columns, rowCount])

  if (characters.length === 0) return null

  return (
    <div ref={parentRef} className={styles.scrollContainer}>
      <div ref={geometryProbeRef} className={styles.geometryProbe} aria-hidden="true" />
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            className={styles.row}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            style={{
              position: 'absolute',
              top: virtualRow.start,
              left: 0,
              right: 0,
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gridAutoRows: 'auto',
              alignItems: 'start',
              gap: `${gap}px`,
              padding: `0 ${gap / 2}px ${gap}px`,
            }}
          >
            {Array.from({ length: columns }).map((_, colIndex) => {
              const character = getCharacter(virtualRow.index, colIndex)
              if (!character) return <div key={colIndex} />
              return (
                <CharacterCard
                  key={character.id}
                  character={character}
                  isFavorite={favSet.has(character.id)}
                  isSelected={batchSet.has(character.id)}
                  batchMode={batchMode}
                  useLargeTier
                  onOpen={onOpen}
                  onEdit={onEdit}
                  onToggleFavorite={onToggleFavorite}
                  onToggleBatch={onToggleBatch}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
