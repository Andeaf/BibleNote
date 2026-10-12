import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { getSchema } from '@tiptap/react'
import { describe, expect, it } from 'vitest'
import { noteExtensions } from '@/features/notes/editor/extensions'
import { formatRef, type BibleRef } from './parser'
import { quoteContent } from './quote'
import { referenceDecorations, referencesPlugin } from './references'

const schema = getSchema(noteExtensions('', () => undefined))
const plugin = referencesPlugin(() => undefined)

const create = (json: unknown) =>
  EditorState.create({ schema, doc: schema.nodeFromJSON(json), plugins: [plugin] })

const paragraph = (text: string) => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : [],
})
const doc = (...blocks: unknown[]) => ({ type: 'doc', content: blocks })

/** [linked text, reference] of every decoration. */
function links(state: EditorState) {
  return (referenceDecorations(state)?.find() ?? [])
    .sort((a, b) => a.from - b.from)
    .map((d) => [state.doc.textBetween(d.from, d.to), formatRef((d.spec as { ref: BibleRef }).ref)])
}

/** Applies a change and checks the updated decorations against a full scan of the result. */
function step(state: EditorState, change: (tr: Transaction) => Transaction): EditorState {
  const next = state.apply(change(state.tr))
  expect(links(next)).toEqual(links(create(next.doc.toJSON())))
  return next
}

describe('reference decorations', () => {
  it('marks references and never changes the document', () => {
    const json = doc(paragraph('Vezi Ioan 3:16 și Psalmul 23.'), paragraph('Fără referințe.'))
    const state = create(json)
    expect(links(state)).toEqual([
      ['Ioan 3:16', 'Ioan 3:16'],
      ['Psalmul 23', 'Psalmul 23'],
    ])
    expect(state.doc.toJSON()).toEqual(json)
  })

  it('follow typing, splitting, joining and deleting, block by block', () => {
    let state = create(doc(paragraph('Vezi Ioan 3:1'), paragraph('Rom 8:28 apoi')))
    expect(links(state)).toEqual([
      ['Ioan 3:1', 'Ioan 3:1'],
      ['Rom 8:28', 'Romani 8:28'],
    ])
    const end = () => state.doc.child(0).nodeSize - 1
    // Typing the rest of the verse, then a list.
    for (const char of '6,18') state = step(state, (tr) => tr.insertText(char, end()))
    expect(links(state)[0]).toEqual(['Ioan 3:16,18', 'Ioan 3:16,18'])
    // Enter inside the reference splits it; joining the blocks again restores it.
    state = step(state, (tr) => tr.split(8))
    expect(links(state).map(([, label]) => label)).toEqual(['Romani 8:28'])
    state = step(state, (tr) => tr.join(9))
    expect(links(state)[0]).toEqual(['Ioan 3:16,18', 'Ioan 3:16,18'])
    // Deleting across both blocks.
    state = step(state, (tr) => tr.delete(4, state.doc.content.size - 6))
    // A whole replacement (a note loaded from another device).
    state = step(state, (tr) =>
      tr.replaceWith(
        0,
        state.doc.content.size,
        schema.nodeFromJSON(doc(paragraph('1 Ioan 4:8'))).content,
      ),
    )
    expect(links(state)).toEqual([['1 Ioan 4:8', '1 Ioan 4:8']])
  })

  it('a hard break separates a name from its number', () => {
    const json = doc({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ioan' },
        { type: 'hardBreak' },
        { type: 'text', text: '3:16 și Ioan 3:17' },
      ],
    })
    expect(links(create(json))).toEqual([['Ioan 3:17', 'Ioan 3:17']])
  })

  it('references inside lists, quotes and headings, across marks', () => {
    const state = create(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Romani 8' }] },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [paragraph('Evr 11:1')] }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Ioan' },
            { type: 'text', text: ' 3:16' },
          ],
        },
      ),
    )
    expect(links(state)).toEqual([
      ['Romani 8', 'Romani 8'],
      ['Evr 11:1', 'Evrei 11:1'],
      ['Ioan 3:16', 'Ioan 3:16'],
    ])
    const inside = TextSelection.create(state.doc, 3)
    expect(inside.$from.parent.type.name).toBe('heading')
  })
})

describe('the inserted quote', () => {
  const ref = (label: string, spans: BibleRef['spans'], chapter = 3): BibleRef => ({
    book: label,
    chapter,
    spans,
  })

  it('one verse: its text and the reference on its own line', () => {
    const one = quoteContent(
      ref('JHN', [{ from: { chapter: 3, verse: 16 }, to: { chapter: 3, verse: 16 } }]),
      [{ chapter: 3, verse: 16, text: 'Fiindcă atât de mult…' }],
    )
    expect(one).toEqual({
      type: 'blockquote',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Fiindcă atât de mult…' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Ioan 3:16' }] },
      ],
    })
    // The schema accepts it.
    expect(() => schema.nodeFromJSON(one).check()).not.toThrow()
  })

  it('several verses carry their numbers, the next chapter shows its number', () => {
    const quote = quoteContent(
      ref('MAT', [{ from: { chapter: 5, verse: 48 }, to: { chapter: 6, verse: 1 } }], 5),
      [
        { chapter: 5, verse: 48, text: 'A.' },
        { chapter: 6, verse: 1, text: 'B.' },
      ],
    )
    expect(quote.content?.[0]?.content).toEqual([
      { type: 'text', marks: [{ type: 'bold' }], text: '48' },
      { type: 'text', text: ' A. ' },
      { type: 'text', marks: [{ type: 'bold' }], text: '6:1' },
      { type: 'text', text: ' B.' },
    ])
    expect(quote.content?.[1]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Matei 5:48-6:1' }],
    })
    // The reference line is a reference again.
    expect(links(create(doc(quote)))).toEqual([['Matei 5:48-6:1', 'Matei 5:48-6:1']])
  })
})
