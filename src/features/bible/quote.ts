import type { JSONContent } from '@tiptap/react'
import { formatRef, type BibleRef } from './parser'
import type { VerseText } from './text'

/**
 * "Inserează în notiță": a quote with the verses and, on its own line, the reference (which the
 * editor then shows as a link again). Several verses carry their numbers in bold; a verse from
 * the next chapter shows the chapter too ("6:1").
 */
export function quoteContent(ref: BibleRef, verses: VerseText[]): JSONContent {
  const text: JSONContent[] = []
  const many = verses.length > 1
  verses.forEach((verse, index) => {
    const space = index < verses.length - 1 ? ' ' : ''
    if (!many) {
      text.push({ type: 'text', text: verse.text })
      return
    }
    const marker =
      verse.chapter !== ref.chapter && verse.verse === 1
        ? `${verse.chapter}:${verse.verse}`
        : `${verse.verse}`
    text.push({ type: 'text', marks: [{ type: 'bold' }], text: marker })
    text.push({ type: 'text', text: ` ${verse.text}${space}` })
  })
  return {
    type: 'blockquote',
    content: [
      { type: 'paragraph', content: text },
      { type: 'paragraph', content: [{ type: 'text', text: formatRef(ref) }] },
    ],
  }
}
