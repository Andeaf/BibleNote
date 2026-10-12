import { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { getSchema } from '@tiptap/react'
import { describe, expect, it } from 'vitest'
import { noteExtensions } from './extensions'
import { insertBlock } from './insertBlock'

const schema = getSchema(noteExtensions('', () => undefined))
const p = (text = '') => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const quote = { type: 'blockquote', content: [p('Q')] }

/** The document as a compact outline, the caret's paragraph marked with "|". */
function outline(node: PMNode, caret: number, pos = -1): string {
  if (node.type.name === 'paragraph') {
    const here = caret > pos && caret < pos + node.nodeSize ? '|' : ''
    return `p(${node.textContent}${here})`
  }
  const children: string[] = []
  node.forEach((child, offset) => children.push(outline(child, caret, pos + 1 + offset)))
  const name = { doc: 'doc', blockquote: 'q', bulletList: 'ul', listItem: 'li' }[node.type.name]
  return `${name ?? node.type.name}[${children.join(' ')}]`
}

function insertAt(blocks: unknown[], pos: (doc: PMNode) => number): string {
  const doc = schema.nodeFromJSON({ type: 'doc', content: blocks })
  const state = EditorState.create({ schema, doc })
  const next = state.apply(insertBlock(state, pos(doc), quote))
  return outline(next.doc, next.selection.from)
}

describe('inserting a quote', () => {
  it('goes after the paragraph, never splitting it; the caret moves below', () => {
    expect(insertAt([p('abc def'), p('next')], () => 3)).toBe('doc[p(abc def) q[p(Q)] p(next|)]')
  })

  it('at the start of a paragraph, goes before it (a second quote follows the first)', () => {
    expect(insertAt([p('a'), p('b')], () => 4)).toBe('doc[p(a) q[p(Q)] p(b|)]')
    const once = schema.nodeFromJSON({ type: 'doc', content: [p('a'), p('b')] })
    let state = EditorState.create({ schema, doc: once })
    state = state.apply(insertBlock(state, 2, quote))
    state = state.apply(insertBlock(state, state.selection.from, quote))
    expect(outline(state.doc, state.selection.from)).toBe('doc[p(a) q[p(Q)] q[p(Q)] p(b|)]')
  })

  it('takes the place of an empty paragraph', () => {
    expect(insertAt([p('a'), p(), p('b')], () => 4)).toBe('doc[p(a) q[p(Q)] p(b|)]')
  })

  it('at the end of the note, adds a line to write on', () => {
    expect(insertAt([p('a')], () => 2)).toBe('doc[p(a) q[p(Q)] p(|)]')
  })

  it('is never nested in another quote: it goes after the outermost one', () => {
    const nested = {
      type: 'blockquote',
      content: [p('x'), { type: 'blockquote', content: [p('y')] }],
    }
    // Inside "y", two quotes deep.
    expect(insertAt([nested, p('z')], () => 7)).toBe('doc[q[p(x) q[p(y)]] q[p(Q)] p(z|)]')
  })

  it('inside a list item it stays in the item', () => {
    const list = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [p('item')] }],
    }
    expect(insertAt([list], () => 4)).toBe('doc[ul[li[p(item) q[p(Q)] p(|)]]]')
  })
})
