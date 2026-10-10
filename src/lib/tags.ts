import { normalize } from './normalize'

export const TAG_MAX_LENGTH = 40
export const TAG_COLOR_COUNT = 8

/** What the user typed, cleaned: no leading "#", single spaces, at most 40 characters. */
export function cleanTag(input: string): string {
  return input.trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, TAG_MAX_LENGTH).trim()
}

/** Two spellings with the same key are the same tag ("Rugăciune" = "rugaciune"). */
export const tagKey = (tag: string): string => normalize(cleanTag(tag))

/**
 * Adds a tag unless the note already has it under any spelling. A tag that exists elsewhere is
 * reused with its existing spelling, so autocomplete and typing end up with one tag, not two.
 */
export function addTag(tags: readonly string[], input: string, known: readonly string[] = []) {
  const tag = cleanTag(input)
  if (!tag) return [...tags]
  const key = tagKey(tag)
  if (tags.some((t) => tagKey(t) === key)) return [...tags]
  return [...tags, known.find((k) => tagKey(k) === key) ?? tag]
}

/** Colour 0–7 from the tag's letters: the same on every device, no setting to sync. */
export function tagColor(tag: string): number {
  let hash = 0
  for (const char of tagKey(tag)) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return hash % TAG_COLOR_COUNT
}

export interface TagUse {
  tag: string
  key: string
  count: number
}

/** Every tag in use, once per key (the most used spelling), with its note count, by name. */
export function collectTags(notes: ReadonlyArray<{ tags: readonly string[] }>): TagUse[] {
  const byKey = new Map<string, { count: number; spellings: Map<string, number> }>()
  for (const note of notes) {
    const seen = new Set<string>()
    for (const tag of note.tags) {
      const key = tagKey(tag)
      if (!key || seen.has(key)) continue
      seen.add(key)
      const entry = byKey.get(key) ?? { count: 0, spellings: new Map() }
      entry.count++
      entry.spellings.set(tag, (entry.spellings.get(tag) ?? 0) + 1)
      byKey.set(key, entry)
    }
  }
  return [...byKey.entries()]
    .map(([key, { count, spellings }]) => ({
      key,
      count,
      tag: [...spellings.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? key,
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag, 'ro', { sensitivity: 'base' }))
}

/** Known tags that start with (or contain) what is typed, minus the ones already on the note. */
export function suggestTags(
  known: readonly string[],
  input: string,
  current: readonly string[],
  limit = 6,
): string[] {
  const query = tagKey(input)
  const taken = new Set(current.map(tagKey))
  const free = known.filter((tag) => !taken.has(tagKey(tag)))
  if (!query) return free.slice(0, limit)
  const starts = free.filter((tag) => tagKey(tag).startsWith(query))
  const contains = free.filter(
    (tag) => !tagKey(tag).startsWith(query) && tagKey(tag).includes(query),
  )
  return [...starts, ...contains].slice(0, limit)
}
