import type { Json } from '@/lib/database.types'

/**
 * Tiptap JSON of a note → Markdown, for the ZIP export. Only the nodes the
 * editor has: headings, paragraphs, bold, italic, underline (<u>), highlight (<mark>), links,
 * bullet / numbered / check lists, quotes, hard breaks. Unknown nodes keep their text.
 */

interface Mark {
  type: string
  attrs?: Record<string, unknown>
}

interface Node {
  type?: string
  text?: string
  marks?: Mark[]
  attrs?: Record<string, unknown>
  content?: Node[]
}

/** Characters Markdown would read as formatting inside text. */
const escapeText = (text: string) => text.replace(/([\\`*_[\]<>])/g, '\\$1')

/** A line that would start a heading, list or quote on its own. */
const escapeLineStart = (line: string) =>
  line.replace(
    /^(\s*)([#>+-]|\d+[.)])(?=\s|$)/,
    (_, space: string, mark: string) =>
      `${space}${mark.replace(/^([#>+-])$/, '\\$1').replace(/^(\d+)([.)])$/, '$1\\$2')}`,
  )

function inline(nodes: Node[] | undefined): string {
  let out = ''
  for (const node of nodes ?? []) {
    if (node.type === 'hardBreak') {
      out += '  \n'
      continue
    }
    if (node.type !== 'text' || !node.text) {
      out += inline(node.content)
      continue
    }
    let text = escapeText(node.text)
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') text = `**${text}**`
      else if (mark.type === 'italic') text = `*${text}*`
      else if (mark.type === 'underline') text = `<u>${text}</u>`
      else if (mark.type === 'highlight') text = `<mark>${text}</mark>`
    }
    const link = node.marks?.find((mark) => mark.type === 'link')
    const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : null
    out += href ? `[${text}](${href.replace(/[()\s]/g, encodeURIComponent)})` : text
  }
  return out
}

const indent = (text: string, prefix: string, rest = ' '.repeat(prefix.length)) =>
  text
    .split('\n')
    .map((line, i) => (i === 0 ? prefix : line ? rest : '') + line)
    .join('\n')

function block(node: Node): string {
  switch (node.type) {
    case 'paragraph':
      return escapeLineStart(inline(node.content))
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)))
      return `${'#'.repeat(level)} ${inline(node.content)}`
    }
    case 'blockquote':
      return blocks(node.content)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n')
    case 'bulletList':
      return (node.content ?? []).map((item) => indent(blocks(item.content), '- ')).join('\n')
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1)
      return (node.content ?? [])
        .map((item, i) => indent(blocks(item.content), `${start + i}. `))
        .join('\n')
    }
    case 'taskList':
      return (node.content ?? [])
        .map((item) =>
          indent(blocks(item.content), item.attrs?.checked ? '- [x] ' : '- [ ] ', '  '),
        )
        .join('\n')
    default:
      return node.content ? blocks(node.content) : inline([node])
  }
}

function blocks(nodes: Node[] | undefined): string {
  return (nodes ?? []).map(block).join('\n\n')
}

/** The note as a Markdown file: its title as a heading, its tags, then the text. */
export function noteToMarkdown(title: string, content: Json, tags: string[]): string {
  const doc = (
    content && typeof content === 'object' && !Array.isArray(content) ? content : {}
  ) as Node
  const parts = [`# ${escapeText(title.trim()) || '…'}`]
  if (tags.length > 0) parts.push(tags.map((tag) => `#${tag}`).join(' '))
  const body = blocks(doc.content).trim()
  if (body) parts.push(body)
  return `${parts.join('\n\n')}\n`
}
