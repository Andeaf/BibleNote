import Highlight from '@tiptap/extension-highlight'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import { BibleReferences, type ReferenceClick } from '@/features/bible/references'
import type { Json } from '@/lib/database.types'

/** The four highlight colours. The key is stored in the note; CSS gives each theme its shade. */
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

/** Highlight that stores only the colour key (data-color), never an inline style. */
const ColorHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: 'yellow',
        parseHTML: (element) => element.getAttribute('data-color') ?? 'yellow',
        renderHTML: (attributes) => ({ 'data-color': attributes.color as string }),
      },
    }
  },
}).configure({ multicolor: true })

/**
 * Exactly the nodes of the spec: H1–H3, bold, italic, underline, highlight in 4 colours, bullet
 * and numbered lists, checklist, quote, link, undo/redo. Markdown shortcuts come with them
 * ("# ", "**x**", "- ", "1. ", "> ", "[] "). Strike, code and horizontal rule are left out.
 * Bible references are decorated as links; `onReference` gets the one tapped.
 */
export function noteExtensions(placeholder: string, onReference: (click: ReferenceClick) => void) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      code: false,
      codeBlock: false,
      strike: false,
      horizontalRule: false,
      // It would append a paragraph to a note ending in a list or heading just by opening it,
      // which counts as an edit (a save and a new version) on every device that opens it.
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      },
    }),
    ColorHighlight,
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder }),
    BibleReferences.configure({ onOpen: onReference }),
  ]
}

/** The stored content as a Tiptap document; anything else (the server default `{}`) is empty. */
export function docOf(content: Json): Record<string, unknown> {
  if (content && typeof content === 'object' && !Array.isArray(content) && content.type === 'doc') {
    return content as Record<string, unknown>
  }
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

/** "exemplu.ro" becomes "https://exemplu.ro"; http(s), mailto and tel are the only schemes kept. */
export function normalizeUrl(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null
  return `https://${value.replace(/^\/+/, '')}`
}
