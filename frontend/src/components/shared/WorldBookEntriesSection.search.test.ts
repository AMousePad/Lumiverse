import { describe, expect, test } from 'bun:test'

const source = await Bun.file(new URL('./WorldBookEntriesSection.tsx', import.meta.url)).text()

describe('regular lorebook panel smart-search contract', () => {
  test('indexes the complete authored-order book and ranks locally', () => {
    expect(source).toContain("sort_by: 'order'")
    expect(source).toContain("sort_dir: 'asc'")
    expect(source).toContain('searchEntriesByQuery(entries, entrySearchFilter, entrySearchIndex)')
    expect(source).toContain('entrySearchResults?.map((result) => result.entry) ?? orderedEntries')
    expect(source).not.toContain('search: search || undefined')
  })

  test('counts query results before applying the selected type', () => {
    expect(source).toContain('for (const entry of queryEntries) counts[getEntryType(entry)] += 1')
    expect(source).toMatch(/entryTypeFilter === 'all'[\s\S]*\? queryEntries[\s\S]*queryEntries\.filter/)
    expect(source).toContain('total: filteredEntries.length')
  })

  test('keeps search clearable, scoped, and independent from the open entry', () => {
    expect(source).toContain('entrySearchInputRef.current?.focus()')
    expect(source).toContain('event.key.toLowerCase() !== \'f\'')
    expect(source).toContain('type="search"')
    expect(source).toContain('clearSearchOnEscape')
    expect(source).toContain('Open entry kept visible while filters are active')
    expect(source).not.toMatch(/onChange=\{\(e\) => \{[\s\S]{0,180}setSelectedEntryId\(null\)/)
  })

  test('renders safe structured highlights and hidden-field context', () => {
    expect(source).toContain('<HighlightedEntryText')
    expect(source).toContain('searchResult?.snippet')
    expect(source).toContain('entrySearchResultsById.get(entry.id)')
    expect(source).not.toContain('dangerouslySetInnerHTML')
  })

  test('resets query and type when the selected lorebook changes', () => {
    expect(source).toContain('setEntrySearchFilter(reset.entrySearchFilter)')
    expect(source).toContain('setEntryTypeFilter(reset.entryTypeFilter)')
  })
})
