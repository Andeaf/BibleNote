import type { NoteRow } from '@/lib/database.types'
import { normalize, normalizeWithMap } from '@/lib/normalize'

/** One note, normalized once (cached by row identity: a changed note is a new object). */
interface Indexed {
  note: NoteRow
  title: string
  tags: string
  text: string
}

const cache = new WeakMap<NoteRow, Indexed>()

function indexed(note: NoteRow): Indexed {
  let entry = cache.get(note)
  if (!entry) {
    entry = {
      note,
      title: normalize(note.title),
      tags: normalize(note.tags.join(' ')),
      text: normalize(note.content_text),
    }
    cache.set(note, entry)
  }
  return entry
}

/** Query words, normalized; a leading "#" is ignored ("#rugăciune" finds the tag). */
export function queryWords(query: string): string[] {
  return normalize(query)
    .split(/\s+/)
    .map((word) => word.replace(/^#+/, ''))
    .filter(Boolean)
}

export interface SearchHit {
  note: NoteRow
  score: number
}

/**
 * Notes that contain every word of the query in their title, tags or text, ignoring case and
 * diacritics. Title matches rank first, then tags, then text; newer first within a rank.
 */
export function searchNotes(notes: readonly NoteRow[], query: string): SearchHit[] {
  const words = queryWords(query)
  if (words.length === 0) return []
  const hits: SearchHit[] = []
  for (const note of notes) {
    const entry = indexed(note)
    let score = 0
    let all = true
    for (const word of words) {
      if (entry.title.includes(word)) score += 3
      else if (entry.tags.includes(word)) score += 2
      else if (entry.text.includes(word)) score += 1
      else {
        all = false
        break
      }
    }
    if (all) hits.push({ note, score })
  }
  return hits.sort(
    (a, b) => b.score - a.score || Date.parse(b.note.updated_at) - Date.parse(a.note.updated_at),
  )
}

export interface Snippet {
  before: string
  match: string
  after: string
}

/**
 * A short piece of `text` around the first query word it contains, cut in the original text
 * (diacritics kept) with the match marked. Null when no word is in the text.
 */
export function snippetOf(text: string, query: string, radius = 50): Snippet | null {
  const { text: normalized, map } = normalizeWithMap(text)
  let found: { start: number; end: number } | null = null
  for (const word of queryWords(query)) {
    const at = normalized.indexOf(word)
    if (at >= 0 && (!found || at < found.start)) found = { start: at, end: at + word.length }
  }
  if (!found) return null
  const start = map[found.start] as number
  const end = map[found.end] as number
  let from = Math.max(0, start - radius)
  let to = Math.min(text.length, end + radius)
  // Cut at spaces so the snippet does not start or end in the middle of a word.
  const spaceAfter = text.indexOf(' ', from)
  if (from > 0 && spaceAfter >= 0 && spaceAfter < start) from = spaceAfter + 1
  const spaceBefore = text.lastIndexOf(' ', to)
  if (to < text.length && spaceBefore > end) to = spaceBefore
  const flat = (s: string) => s.replace(/\s+/g, ' ')
  return {
    before: (from > 0 ? '…' : '') + flat(text.slice(from, start)),
    match: flat(text.slice(start, end)),
    after: flat(text.slice(end, to)) + (to < text.length ? '…' : ''),
  }
}
