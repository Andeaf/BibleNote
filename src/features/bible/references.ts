import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Extension } from '@tiptap/react'
import { findReferences, type BibleRef } from './parser'

/** A reference the reader tapped: what it means and where it is in the document. */
export interface ReferenceClick {
  ref: BibleRef
  from: number
  to: number
  element: HTMLElement
}

interface BibleReferencesOptions {
  onOpen: (click: ReferenceClick) => void
}

const key = new PluginKey<DecorationSet>('bibleReferences')

/** The references of one textblock (hard breaks count as one character, as in the document). */
function blockDecorations(node: PMNode, pos: number): Decoration[] {
  const text = node.textBetween(0, node.content.size, '\n', '￼')
  return findReferences(text).map(({ ref, start, end }) =>
    Decoration.inline(pos + 1 + start, pos + 1 + end, { class: 'bn-ref' }, { ref }),
  )
}

function allDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    decorations.push(...blockDecorations(node, pos))
    return false
  })
  return DecorationSet.create(doc, decorations)
}

/**
 * Bible references in the note shown as discreet links. Decorations only:
 * the saved document never changes, so opening a note is never an edit. After a change only the
 * touched textblocks are scanned again. A click on a reference calls `onOpen`; the caret is
 * placed as usual, so a reference can still be edited.
 */
export const BibleReferences = Extension.create<BibleReferencesOptions>({
  name: 'bibleReferences',

  addOptions() {
    return { onOpen: () => undefined }
  },

  addProseMirrorPlugins() {
    return [referencesPlugin((click) => this.options.onOpen(click))]
  },
})

/** The decorations in `state` (for tests). */
export function referenceDecorations(state: EditorState): DecorationSet | undefined {
  return key.getState(state)
}

export function referencesPlugin(onOpen: (click: ReferenceClick) => void): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, { doc }) => allDecorations(doc),
      apply(tr, set) {
        if (!tr.docChanged) return set
        let next = set.map(tr.mapping, tr.doc)
        const touched: Array<[number, number]> = []
        tr.mapping.maps.forEach((map, index) => {
          const rest = tr.mapping.slice(index + 1)
          map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
            touched.push([rest.map(newStart, -1), rest.map(newEnd, 1)])
          })
        })
        const size = tr.doc.content.size
        for (const [start, end] of touched) {
          const from = Math.max(0, start - 1)
          const to = Math.min(size, end + 1)
          tr.doc.nodesBetween(from, to, (node, pos) => {
            if (!node.isTextblock) return true
            next = next.remove(next.find(pos, pos + node.nodeSize))
            next = next.add(tr.doc, blockDecorations(node, pos))
            return false
          })
        }
        return next
      },
    },
    props: {
      decorations: (state) => key.getState(state),
      handleClick(view, pos, event) {
        const element = (event.target as Element | null)?.closest?.('.bn-ref')
        if (!(element instanceof HTMLElement)) return false
        const found = key
          .getState(view.state)
          ?.find(pos, pos)
          .find((decoration) => decoration.from <= pos && pos <= decoration.to)
        if (!found) return false
        onOpen({
          ref: (found.spec as { ref: BibleRef }).ref,
          from: found.from,
          to: found.to,
          element,
        })
        return false
      },
    },
  })
}
