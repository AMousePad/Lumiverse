import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { BookOpen, Edit3, MessageSquare, Pin, PinOff, Search, Settings, Star, X } from 'lucide-react'
import { getCharacterAvatarLargeUrlById } from '@/lib/avatarUrls'
import { getTagColorVar } from '@/lib/tagColors'
import {
  getCharacterGridMetrics,
  getHomepageCardMetadata,
  getHomepageVisibleTags,
} from '@/lib/characterDisplaySettings'
import type { CharacterDisplaySettings } from '@/types/store'
import type { CharacterSummary } from '@/types/api'
import { Button } from '@/components/shared/FormComponents'
import {
  clampHomepagePanelImageHeight,
  clampHomepagePanelWidth,
  useHomepageCharacterLibrary,
  HOMEPAGE_PANEL_IMAGE_HEIGHT_DEFAULT,
  HOMEPAGE_PANEL_IMAGE_HEIGHT_MAX,
  HOMEPAGE_PANEL_IMAGE_HEIGHT_MIN,
} from '@/hooks/useHomepageCharacterLibrary'
import type { HomepageCharacterFilter } from '@/hooks/useHomepageCharacterLibrary'
import styles from './HomepageCharacterLibrary.module.css'

const FILTER_LABELS: Record<HomepageCharacterFilter, string> = {
  all: 'All',
  'this-chat': 'This Chat',
  favorites: 'Favorites',
  shared: 'Shared',
}

const FILTER_ORDER: readonly HomepageCharacterFilter[] = ['all', 'this-chat', 'favorites', 'shared']

const PROFILE_TAG_LIMIT = 8

/**
 * Tag colour arrives as a CSS custom property, never as a painted value. The stylesheet
 * composes the alpha (`rgba(var(--tag-rgb), 0.15)`), so a user override written against
 * `[data-component="HomepageCharacterLibrary"] .tag` still wins — an inline `background`
 * would have outranked it.
 */
function tagColorStyle(tag: string): CSSProperties {
  return { '--tag-rgb': getTagColorVar(tag) } as CSSProperties
}

interface LibraryCardProps {
  character: CharacterSummary
  selected: boolean
  footerMode: CharacterDisplaySettings['footerMode']
  showNameBackground: boolean
  showCreator: boolean
  showTags: boolean
  tagRows: number
  maxVisibleTags: number
  onSelect: (id: string) => void
  onOpen: (character: CharacterSummary) => void
}

/**
 * Memoised on primitives only. `display.visibleMetadata` is a fresh array on every settings
 * write, so it is flattened to `showCreator`/`showTags` before it reaches here — otherwise
 * every card would re-render whenever the panel is dragged or a selection is persisted.
 */
const LibraryCard = memo(function LibraryCard({
  character,
  selected,
  footerMode,
  showNameBackground,
  showCreator,
  showTags,
  tagRows,
  maxVisibleTags,
  onSelect,
  onOpen,
}: LibraryCardProps) {
  const cardMetadata = getHomepageCardMetadata(character)
  const { visibleTags, hiddenTagCount } = getHomepageVisibleTags(
    cardMetadata.tags,
    maxVisibleTags,
    tagRows,
  )

  return (
    <button
      type="button"
      className={selected ? styles.cardSelected : styles.card}
      data-footer-mode={footerMode}
      data-name-background={showNameBackground}
      aria-label={`Preview ${character.name}`}
      aria-pressed={selected}
      onClick={() => onSelect(character.id)}
      onDoubleClick={() => onOpen(character)}
    >
      <span className={styles.imageFrame}>
        <img
          src={getCharacterAvatarLargeUrlById(character.id, character.image_id)}
          alt={character.name}
          loading="lazy"
        />
      </span>
      <span className={styles.cardFooter}>
        <span className={styles.cardName}>{character.name}</span>
        {showCreator && cardMetadata.creator && (
          <span className={styles.cardMeta}>{cardMetadata.creator}</span>
        )}
        {tagRows > 0 && showTags && visibleTags.length > 0 && (
          <span className={styles.tags}>
            {visibleTags.map((tag) => (
              <span key={tag} className={styles.tag} style={tagColorStyle(tag)} title={tag}>
                {tag}
              </span>
            ))}
            {hiddenTagCount > 0 && <span className={styles.tagOverflow}>+{hiddenTagCount}</span>}
          </span>
        )}
      </span>
    </button>
  )
})

export function HomepageCharacterLibrary() {
  const {
    settings,
    display,
    characters,
    tags,
    selectedCharacter,
    preview,
    panelOpen,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    previewLoading,
    error,
    retry,
    filter,
    setFilter,
    search,
    setSearch,
    selectedTag,
    setSelectedTag,
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
    openSettings,
    activeChatId,
    selectCharacter,
    openingCharacterId,
    openCharacterChat,
    editCharacter,
    closePanel,
    setPanelPinned,
    setPanelWidth,
    setPanelImageHeight,
  } = useHomepageCharacterLibrary()

  // Live drag values. Writing straight to the store on every pointermove queued a debounced
  // server write and re-rendered the whole library ~90 times a second; the store now only
  // sees the committed value on pointer-up.
  const [livePanelWidth, setLivePanelWidth] = useState<number | null>(null)
  const [liveImageHeight, setLiveImageHeight] = useState<number | null>(null)

  // Infinite scroll. The sentinel is only mounted while there is another page to ask for,
  // so unmounting it is itself the "stop" signal — the observer below tears down with it.
  const sentinelRef = useRef<HTMLDivElement>(null)
  const showSentinel = hasMore && characters.length > 0
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || loading) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore()
      },
      // Deep enough to start the next request before the user reaches the last row, so the
      // grid grows without a visible stall.
      { rootMargin: '400px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
    // `characters.length` re-arms the observer after each append. Without it a page that
    // lands while the sentinel is still inside the root margin produces no new
    // intersection entry, and paging stalls until the user scrolls away and back.
  }, [characters.length, loadMore, loading, showSentinel])

  const panelWidth = livePanelWidth ?? settings.panelWidth
  const panelImageHeight = liveImageHeight
    ?? settings.panelImageHeight
    ?? HOMEPAGE_PANEL_IMAGE_HEIGHT_DEFAULT

  const beginResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = settings.panelWidth
    let latest = startWidth
    let frame = 0
    const onMove = (moveEvent: PointerEvent) => {
      latest = clampHomepagePanelWidth(startWidth + startX - moveEvent.clientX)
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        setLivePanelWidth(latest)
      })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      if (frame) window.cancelAnimationFrame(frame)
      setLivePanelWidth(null)
      setPanelWidth(latest)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }, [settings.panelWidth, setPanelWidth])

  const commitImageHeight = useCallback(() => {
    if (liveImageHeight === null) return
    setPanelImageHeight(liveImageHeight)
    setLiveImageHeight(null)
  }, [liveImageHeight, setPanelImageHeight])

  // ~900 <option> nodes. Rebuilding them on every render was the dominant cost in the
  // component; a stable element array lets React bail out of the whole subtree.
  const tagOptions = useMemo(
    () => tags.map(({ tag, count }) => <option key={tag} value={tag}>{tag} ({count})</option>),
    [tags],
  )

  const gridMetrics = getCharacterGridMetrics(display)
  const maxVisibleTags = settings.maxVisibleTags ?? 6
  const showNameBackground = settings.showNameBackground ?? false
  const showCreator = display.visibleMetadata.includes('creator')
  const showTags = display.visibleMetadata.includes('tags')
  const tagRowsMaxHeight = display.tagRows > 0
    ? display.tagRows * 20 + Math.max(display.tagRows - 1, 0) * 4
    : 0
  const compactFooterMaxHeight = 44 + tagRowsMaxHeight
  const selectedCharacterId = selectedCharacter?.id ?? null
  const selectedAvatarUrl = selectedCharacter
    ? getCharacterAvatarLargeUrlById(selectedCharacter.id, selectedCharacter.image_id)
    : ''
  const selectedTagSummary = selectedCharacter
    ? getHomepageVisibleTags(selectedCharacter.tags, PROFILE_TAG_LIMIT, 1)
    : { visibleTags: [], hiddenTagCount: 0 }

  const cards = useMemo(() => characters.map((character) => (
    <LibraryCard
      key={character.id}
      character={character}
      selected={selectedCharacterId === character.id}
      footerMode={display.footerMode}
      showNameBackground={showNameBackground}
      showCreator={showCreator}
      showTags={showTags}
      tagRows={display.tagRows}
      maxVisibleTags={maxVisibleTags}
      onSelect={selectCharacter}
      onOpen={openCharacterChat}
    />
  )), [
    characters,
    display.footerMode,
    display.tagRows,
    maxVisibleTags,
    openCharacterChat,
    selectCharacter,
    selectedCharacterId,
    showCreator,
    showNameBackground,
    showTags,
  ])

  if (!settings.enabled) return null

  return (
    <section
      className={styles.library}
      data-component="HomepageCharacterLibrary"
      aria-label="Character library"
    >
      <div className={styles.header}>
        <div>
          <h2>Character Library</h2>
          <p>Browse, preview, and open characters without entering management.</p>
        </div>
        <label className={styles.searchField}>
          <Search size={14} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search names, tags, creators..."
            aria-label="Search characters"
            className={styles.search}
          />
        </label>
        <Button
          variant="secondary"
          size="sm"
          icon={<Settings size={15} />}
          className={styles.settingsBtn}
          onClick={openSettings}
          title="Homepage character library settings"
        >
          Settings
        </Button>
      </div>

      <div className={styles.controls}>
        <div className={styles.filters} role="group" aria-label="Character filter">
          {FILTER_ORDER.map((item) => (
            <button
              key={item}
              type="button"
              className={filter === item ? styles.filterActive : styles.filter}
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
            >
              {FILTER_LABELS[item]}
            </button>
          ))}
        </div>
        <select
          value={selectedTag}
          onChange={(event) => setSelectedTag(event.target.value)}
          aria-label="Filter by tag"
          className={styles.select}
        >
          <option value="">All tags</option>
          {tagOptions}
        </select>
        <select
          value={sortField}
          onChange={(event) => setSortField(event.target.value as typeof sortField)}
          aria-label="Sort characters by"
          className={styles.select}
        >
          <option value="recent">Recently used</option>
          <option value="name">Name</option>
          <option value="created">Created</option>
          <option value="shuffle">Discover</option>
        </select>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
          disabled={sortField === 'shuffle'}
        >
          {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
        </Button>
      </div>

      {error && (
        <div className={styles.state} data-state="error" role="alert">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={retry}>Retry</Button>
        </div>
      )}
      {loading && characters.length === 0 && <div className={styles.state} data-state="loading" role="status">Loading characters...</div>}
      {!loading && !error && filter === 'this-chat' && !activeChatId && (
        <div className={styles.state} data-state="empty">No active chat is selected.</div>
      )}

      <div
        className={styles.body}
        data-panel-open={panelOpen && !!selectedCharacter}
        style={{
          '--homepage-panel-width': `${panelWidth}px`,
          '--homepage-panel-image-height': `${panelImageHeight}px`,
        } as CSSProperties}
      >
        <div
          className={styles.grid}
          style={{
            '--character-card-width': `${display.thumbnailWidth}px`,
            '--character-image-height': `${display.thumbnailHeight}px`,
            '--character-tags-max-height': `${tagRowsMaxHeight}px`,
            '--character-footer-max-height': `${compactFooterMaxHeight}px`,
            '--character-grid-gap': `${gridMetrics.gap}px`,
          } as CSSProperties}
        >
          {!loading && !error && characters.length === 0 && !(filter === 'this-chat' && !activeChatId) && (
            <div className={styles.state} data-state="empty">No characters match the current library filters.</div>
          )}
          {cards}
          {!loading && activeChatId && filter === 'this-chat' && characters.length === 0 && (
            <div className={styles.state} data-state="empty">The active chat has no available characters.</div>
          )}
          {loadingMore && <div className={styles.loadingMore}>Loading more characters...</div>}
          {showSentinel && <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />}
        </div>

        {panelOpen && selectedCharacter && (
          <aside className={styles.preview} data-pinned={settings.panelPinned}>
            <div className={styles.resizeHandle} onPointerDown={beginResize} aria-hidden="true" />
            <div className={styles.previewControls}>
              <button
                type="button"
                title={settings.panelPinned ? 'Unpin preview' : 'Pin preview'}
                onClick={() => setPanelPinned(!settings.panelPinned)}
              >
                {settings.panelPinned ? <Pin size={15} /> : <PinOff size={15} />}
              </button>
              <button type="button" title="Close preview" onClick={closePanel}><X size={16} /></button>
            </div>
            <div
              className={styles.previewImageFrame}
              style={{ '--preview-image-url': `url("${selectedAvatarUrl}")` } as CSSProperties}
            >
              <img
                src={selectedAvatarUrl}
                alt={selectedCharacter.name}
              />
            </div>
            <label className={styles.imageHeightControl}>
              <span>Image H</span>
              <input
                type="range"
                min={HOMEPAGE_PANEL_IMAGE_HEIGHT_MIN}
                max={HOMEPAGE_PANEL_IMAGE_HEIGHT_MAX}
                value={panelImageHeight}
                onChange={(event) => setLiveImageHeight(
                  clampHomepagePanelImageHeight(Number(event.target.value)),
                )}
                onPointerUp={commitImageHeight}
                onKeyUp={commitImageHeight}
                onBlur={commitImageHeight}
              />
              <span>{panelImageHeight}px</span>
            </label>
            <div className={styles.previewHeader}>
              <div>
                <h3>{selectedCharacter.name}</h3>
                {selectedCharacter.creator && <p>{selectedCharacter.creator}</p>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={<Edit3 size={14} />}
                className={styles.editBtn}
                title="Edit character"
                onClick={() => editCharacter(selectedCharacter.id)}
              >
                Edit
              </Button>
            </div>
            <div className={styles.previewTags}>
              {selectedCharacter.has_alternate_greetings && <span><Star size={12} /> Alt greetings</span>}
              {selectedTagSummary.visibleTags.map((tag) => (
                <span key={tag} className={styles.previewTag} style={tagColorStyle(tag)}>{tag}</span>
              ))}
              {selectedTagSummary.hiddenTagCount > 0 && <span>+{selectedTagSummary.hiddenTagCount}</span>}
            </div>
            {previewLoading && <div className={styles.state}>Loading preview...</div>}
            {!previewLoading && preview && (
              <>
                <div className={styles.previewSection}>
                  <h4><BookOpen size={14} /> Lorebooks</h4>
                  {preview.lorebooks.length > 0
                    ? <div className={styles.lorebooks}>{preview.lorebooks.map((book) => <span key={book.id}>{book.name}</span>)}</div>
                    : <p>No attached lorebooks</p>}
                </div>
                <div className={styles.previewSection}>
                  <h4><MessageSquare size={14} /> Last chat</h4>
                  {preview.last_chat
                    ? <div className={styles.lastChat}><strong>{preview.last_chat.name || selectedCharacter.name}</strong><p>{preview.last_chat.last_message_preview || 'No messages yet'}</p></div>
                    : <p>No existing chat</p>}
                </div>
              </>
            )}
            <Button
              variant="primary"
              icon={<MessageSquare size={15} />}
              className={styles.openChatBtn}
              disabled={previewLoading || openingCharacterId === selectedCharacter.id}
              onClick={() => openCharacterChat(selectedCharacter)}
            >
              {preview?.open_chat_id ? 'Open in chat' : 'Start chat'}
            </Button>
          </aside>
        )}
      </div>
    </section>
  )
}
