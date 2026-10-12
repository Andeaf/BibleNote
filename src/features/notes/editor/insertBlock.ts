import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { JSONContent } from '@tiptap/react'

/**
 * Puts a block (a Bible quote) near `pos` without splitting what is written there: after the
 * textblock at `pos` (before it when `pos` is at its start), after the outermost quote around it
 * (quotes are never nested), or in place of an empty paragraph. The caret goes to the line
 * after the new block; at the end of its container an empty paragraph is added for it, so
 * writing goes on below the quote (and a second quote follows the first).
 */
export function insertBlock(state: EditorState, pos: number, content: JSONContent): Transaction {
  const { tr, schema } = state
  const node = schema.nodeFromJSON(content)
  const $pos = state.doc.resolve(pos)
  let from = pos
  let to = pos
  if ($pos.parent.isTextblock) {
    let depth = $pos.depth
    for (let d = 1; d < $pos.depth; d++) {
      if ($pos.node(d).type.name === 'blockquote') {
        depth = d
        break
      }
    }
    const empty = $pos.parent.type.name === 'paragraph' && $pos.parent.content.size === 0
    if (depth === $pos.depth && empty) {
      from = $pos.before(depth)
      to = $pos.after(depth)
    } else if (depth === $pos.depth && $pos.parentOffset === 0) {
      from = to = $pos.before(depth)
    } else {
      from = to = $pos.after(depth)
    }
  }
  tr.replaceWith(from, to, node)
  const end = from + node.nodeSize
  const paragraph = schema.nodes.paragraph
  if (paragraph && !tr.doc.resolve(end).nodeAfter) tr.insert(end, paragraph.create())
  tr.setSelection(TextSelection.near(tr.doc.resolve(end + 1)))
  return tr.scrollIntoView()
}
