/**
 * Per-entry memo for the lorebook entry-search haystack.
 *
 * `LorebookEditorWorkspace`'s `filteredEntries` used to run
 * `entry.content.toLowerCase()` inside the filter callback, so **every keystroke
 * in the entry search box case-folded the entire book**. On the real 554-entry
 * book that is 1.18 MB of `content` (plus every `comment` and every `key`)
 * re-lowercased, and re-allocated, per character typed — three fresh strings per
 * entry per keystroke, all of them garbage a millisecond later.
 *
 * The fix is the same shape as `entryTokenKey`: fold the case **once per entry
 * per edit** instead of once per entry per keystroke. The query is folded once
 * per call, which is free.
 *
 * **Why a `WeakMap` on the entry object rather than a `Map` on `entry.id`.**
 * `commitEntries` is strictly immutable — `saveEntry` rebuilds the changed entry
 * with `{ ...entry, ...updates }` and `loadEntries` replaces the array wholesale
 * — so object identity changes exactly when the text might have. Keying on the
 * object cannot go stale, needs no revision field, and needs no eviction: an
 * entry dropped from React state is collected together with its haystack. An
 * id-keyed `Map` would have to be invalidated by hand and would retain a full
 * lowercased copy of every entry seen this session.
 *
 * **Why three separate folded fields rather than one concatenated haystack.**
 * One string would mean one `includes` instead of three, but joining invents
 * matches across the seam — a comment ending `"foo"` before content starting
 * `"bar"` would match `"o b"` — and every separator cheap enough to be
 * unmatchable is a control character, which makes the source file read as binary
 * to grep and friends. Three reads are the same asymptotic work and preserve the
 * original per-field semantics exactly.
 *
 * The four source lengths are re-checked on every hit. They cost four integer
 * comparisons and they make an in-place mutation of a retained object fail safe
 * — a rebuild rather than a silently stale haystack.
 *
 * React-free, store-free, DOM-free, and the fold is injectable so a test can
 * count how many full passes were actually paid for.
 */

/**
 * The searchable slice of a world-book entry, declared structurally so this
 * module does not import the API types (and so a test can drive it with plain
 * objects). A real `WorldBookEntry` satisfies it.
 */
export interface SearchableEntry {
  comment: string
  content: string
  key: string[]
}

/** The three fields of one entry, already lowercased. */
export interface FoldedEntry {
  comment: string
  content: string
  keys: string[]
}

export type EntryFolder = (entry: SearchableEntry) => FoldedEntry

interface HaystackRecord extends FoldedEntry {
  commentLength: number
  contentLength: number
  keyCount: number
  keyLength: number
}

export interface EntrySearchIndex {
  /** Case-insensitive substring test. `query` must already be normalised. */
  matches(entry: SearchableEntry, query: string): boolean
  /** Full case-folds actually performed. Test seam; not used in production. */
  folds(): number
}

/** Sum of key lengths — cheap, and catches an edit that preserves key count. */
function keyLengthOf(entry: SearchableEntry): number {
  let total = 0
  for (const key of entry.key) total += key.length
  return total
}

/**
 * The one place the raw entry-search string is normalised: trimmed so a trailing
 * space from a paste does not blank the list, lowercased so matching is
 * case-insensitive. Idempotent.
 */
export function normalizeEntryQuery(query: string): string {
  return query.trim().toLowerCase()
}

/** Default fold: the same three fields the original inline filter searched. */
export function foldEntry(entry: SearchableEntry): FoldedEntry {
  return {
    comment: entry.comment.toLowerCase(),
    content: entry.content.toLowerCase(),
    keys: entry.key.map((key) => key.toLowerCase()),
  }
}

export function createEntrySearchIndex(fold: EntryFolder = foldEntry): EntrySearchIndex {
  const memo = new WeakMap<SearchableEntry, HaystackRecord>()
  let folds = 0

  return {
    matches(entry, query) {
      if (!query) return true

      const commentLength = entry.comment.length
      const contentLength = entry.content.length
      const keyCount = entry.key.length
      const keyLength = keyLengthOf(entry)

      let record = memo.get(entry)
      if (
        !record
        || record.commentLength !== commentLength
        || record.contentLength !== contentLength
        || record.keyCount !== keyCount
        || record.keyLength !== keyLength
      ) {
        folds += 1
        record = { commentLength, contentLength, keyCount, keyLength, ...fold(entry) }
        memo.set(entry, record)
      }

      // Field order matches the original inline filter: comment, content, keys.
      return record.comment.includes(query)
        || record.content.includes(query)
        || record.keys.some((key) => key.includes(query))
    },
    folds() {
      return folds
    },
  }
}

/**
 * Filters by the search query only — the type filter stays in the component,
 * where `getTriggerType` lives.
 *
 * An empty (or whitespace-only) query returns the **input array itself**, not a
 * copy, matching `filterBooks` and `filterActions`. Consumers rely on that
 * identity to skip work, and it means an unused search box costs nothing at all.
 *
 * `query` is normalised here so a caller cannot pass a raw string by mistake;
 * normalisation is idempotent, so passing an already-normalised one is free.
 */
export function filterEntriesByQuery<T extends SearchableEntry>(
  entries: T[],
  query: string,
  index: EntrySearchIndex,
): T[] {
  const needle = normalizeEntryQuery(query)
  if (!needle) return entries
  return entries.filter((entry) => index.matches(entry, needle))
}
