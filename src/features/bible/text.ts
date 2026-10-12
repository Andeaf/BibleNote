import { useEffect, useState } from 'react'
import { formatRef, refVerses, type BibleRef, type VersePoint } from './parser'

/** One book as built by scripts/build-bible.ts. */
export interface BookText {
  id: string
  name: string
  chapters: string[][]
}

export interface VerseText extends VersePoint {
  text: string
}

const books = new Map<string, Promise<BookText>>()

/**
 * The text of a book, from public/bible/rccv (precached by the service worker, so it works
 * offline once the app is installed). Kept in memory; a failed load is tried again next time.
 */
export function loadBook(id: string): Promise<BookText> {
  let book = books.get(id)
  if (!book) {
    book = fetch(`${import.meta.env.BASE_URL}bible/rccv/${id}.json`).then(async (response) => {
      if (!response.ok) throw new Error(`bible ${id}: ${response.status}`)
      return (await response.json()) as BookText
    })
    book.catch(() => books.delete(id))
    books.set(id, book)
  }
  return book
}

export function versesOf(book: BookText, ref: BibleRef): VerseText[] {
  return refVerses(ref).map((point) => ({
    ...point,
    text: book.chapters[point.chapter - 1]?.[point.verse - 1] ?? '',
  }))
}

export type VersesState =
  { status: 'loading' } | { status: 'ready'; verses: VerseText[] } | { status: 'error' }

/** The verses of a reference (null: nothing to load). */
export function useVerses(ref: BibleRef | null): VersesState {
  const key = ref ? formatRef(ref) : ''
  const [result, setResult] = useState<{ key: string; state: VersesState } | null>(null)

  useEffect(() => {
    if (!ref) return
    let current = true
    loadBook(ref.book).then(
      (book) =>
        current && setResult({ key, state: { status: 'ready', verses: versesOf(book, ref) } }),
      () => current && setResult({ key, state: { status: 'error' } }),
    )
    return () => {
      current = false
    }
    // The label stands for the reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return result?.key === key && ref ? result.state : { status: 'loading' }
}
